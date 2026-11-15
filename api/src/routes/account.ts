import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { ah, HttpError, toCamel } from '../http.js';
import { q, withTx } from '../db.js';
import { consumeOtp, issueOtp, normalizePhone, requireAuth } from '../security.js';
import { defaultPayoutProvider, email, sms } from '../providers.js';
import { dispatchPayout } from '../payouts.js';
import { config, isProd } from '../config.js';
import { sniffDocument } from '../images.js';
import { bodyBuffer, checkQuota, rawFile, storeFile } from './media.js';

export const accountRouter = Router();
accountRouter.use(['/me', '/payouts'], requireAuth);

// ---------- Profil du compte ----------
accountRouter.get('/me/profile', ah(async (req, res) => {
  const r = (await q(
    'SELECT id, email, phone, full_name, locale, role, account_status, email_verified_at, phone_verified_at, created_at FROM users WHERE id = $1 AND deleted_at IS NULL',
    [req.user!.id])).rows[0];
  if (!r) throw new HttpError(401, 'Session invalide', 'unauthenticated');
  res.json({ profile: toCamel(r) });
}));

accountRouter.patch('/me/profile', ah(async (req, res) => {
  const body = z.object({
    fullName: z.string().trim().min(2).max(120).optional(),
    locale: z.enum(['fr', 'en']).optional(),
  }).strict().refine((v) => Object.keys(v).length > 0, 'Au moins un champ doit être fourni').parse(req.body);
  const r = (await q(
    `UPDATE users
        SET full_name = COALESCE($2, full_name),
            locale = COALESCE($3, locale)
      WHERE id = $1 AND deleted_at IS NULL AND account_status = 'active'
      RETURNING id, email, phone, full_name, locale, role, account_status, email_verified_at, phone_verified_at, created_at`,
    [req.user!.id, body.fullName ?? null, body.locale ?? null])).rows[0];
  if (!r) throw new HttpError(401, 'Session invalide', 'unauthenticated');
  res.json({ profile: toCamel(r) });
}));

const kycPublic = (r: any) => r && toCamel({
  id: r.id, type: r.type, legal_name: r.legal_name, id_document_type: r.id_document_type, niu: r.niu, payout_method: r.payout_method,
  payout_phone_masked: r.payout_phone.slice(0, 4) + '** *** *' + r.payout_phone.slice(-2), payout_account_name: r.payout_account_name,
  status: r.status, rejection_reason: r.rejection_reason, submitted_at: r.submitted_at, reviewed_at: r.reviewed_at });

// ---------- Coordonnées secondaires (email / téléphone) ----------
function maskContactPhone(phone: string) { return phone.replace(/^(\+\d{3})\d+(\d{2})$/, '$1•••••••$2'); }
accountRouter.get('/me/contacts', ah(async (req, res) => {
  const u = (await q('SELECT email, phone, email_verified_at, phone_verified_at FROM users WHERE id = $1 AND deleted_at IS NULL', [req.user!.id])).rows[0];
  if (!u) throw new HttpError(401, 'Session invalide', 'unauthenticated');
  res.json({ contacts: { email: u.email, emailVerified: !!u.email_verified_at, phone: u.phone ? maskContactPhone(u.phone) : null, phoneVerified: !!u.phone_verified_at } });
}));
accountRouter.post('/me/contacts/challenge', ah(async (req, res) => {
  const b = z.object({ channel: z.enum(['email', 'sms']), target: z.string().min(3).max(254) }).strict().parse(req.body);
  const target = b.channel === 'email' ? z.string().email().parse(b.target).toLowerCase() : normalizePhone(b.target);
  const col = b.channel === 'email' ? 'email' : 'phone';
  const duplicate = (await q(`SELECT id FROM users WHERE ${col} = $1 AND id <> $2 AND deleted_at IS NULL`, [target, req.user!.id])).rows[0];
  if (duplicate) throw new HttpError(409, 'Cette coordonnée est déjà utilisée par un autre compte', 'contact_in_use');
  const token = jwt.sign({ sub: req.user!.id, purpose: 'contact', channel: b.channel, target }, config.JWT_SECRET, { algorithm: 'HS256', expiresIn: '10m' });
  const code = await withTx(null, (c) => issueOtp(c, 'contact', b.channel, target, req.ip));
  const message = `Votre code VOTALLY est : ${code}. Il expire dans 10 minutes. Ne le communiquez à personne.`;
  if (b.channel === 'email') await email.send({ to: target, subject: 'VOTALLY — Vérification du contact', text: message });
  else await sms.send(target, message);
  res.json({ message: 'Code envoyé', challenge: token, ...(isProd ? {} : { devCode: code }) });
}));
accountRouter.post('/me/contacts/verify', ah(async (req, res) => {
  const b = z.object({ challenge: z.string(), code: z.string().regex(/^\d{6}$/) }).strict().parse(req.body);
  let p: jwt.JwtPayload;
  try { p = jwt.verify(b.challenge, config.JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload; }
  catch { throw new HttpError(400, 'Demande de vérification expirée', 'contact_challenge_expired'); }
  if (p.purpose !== 'contact' || p.sub !== req.user!.id || !['email', 'sms'].includes(String(p.channel)) || typeof p.target !== 'string')
    throw new HttpError(400, 'Demande de vérification invalide', 'contact_challenge_invalid');
  const channel = p.channel as 'email' | 'sms', target = p.target;
  if (!(await consumeOtp('contact', target, b.code))) throw new HttpError(400, 'Code invalide ou expiré', 'invalid_code');
  const col = channel === 'email' ? 'email' : 'phone', verifiedCol = channel === 'email' ? 'email_verified_at' : 'phone_verified_at';
  const duplicate = (await q(`SELECT id FROM users WHERE ${col} = $1 AND id <> $2 AND deleted_at IS NULL`, [target, req.user!.id])).rows[0];
  if (duplicate) throw new HttpError(409, 'Cette coordonnée est déjà utilisée par un autre compte', 'contact_in_use');
  await q(`UPDATE users SET ${col} = $2, ${verifiedCol} = now() WHERE id = $1`, [req.user!.id, target]);
  res.json({ message: 'Coordonnée vérifiée et enregistrée' });
}));

// ---------- Vérification d'identité (KYC) ----------
/** Envoi d'une pièce justificative (privée : seul un administrateur peut la consulter). */
accountRouter.post('/me/kyc/documents', rawFile, ah(async (req, res) => {
  const kind = z.enum(['id', 'org']).parse(req.query.kind);
  await checkQuota(req.user!.id, ['kyc_id', 'kyc_org'], 12);
  const data = bodyBuffer(req);
  const doc = await sniffDocument(data);
  const key = await storeFile({ userId: req.user!.id, data, ext: doc.ext, contentType: doc.contentType, purpose: kind === 'id' ? 'kyc_id' : 'kyc_org', visibility: 'private' });
  res.status(201).json({ key });
}));

accountRouter.get('/me/kyc', ah(async (req, res) => {
  const r = (await q('SELECT * FROM creator_kyc WHERE user_id = $1 ORDER BY submitted_at DESC LIMIT 1', [req.user!.id])).rows[0];
  res.json({ kyc: kycPublic(r) ?? null });
}));

const kycBody = z.object({
  type: z.enum(['individual', 'organization']),
  legalName: z.string().trim().min(3).max(160),
  idDocumentType: z.enum(['cni', 'passport']),
  idDocumentKey: z.string(),
  organizationDocKeys: z.record(z.string().max(40), z.string()).default({}),     // ex. { recepisse: clé, rccm: clé }
  niu: z.string().trim().max(40).nullish(),
  payoutMethod: z.enum(['mtn_momo', 'orange_money']),
  payoutPhone: z.string(),
  payoutAccountName: z.string().trim().min(3).max(160),
});

accountRouter.post('/me/kyc', ah(async (req, res) => {
  const b = kycBody.parse(req.body);
  const keys = [b.idDocumentKey, ...Object.values(b.organizationDocKeys)];
  // Chaque pièce doit avoir été envoyée par CET utilisateur, avec le bon usage
  const owned = (await q(`SELECT key, purpose FROM uploads WHERE owner_user_id = $1 AND key = ANY($2)`, [req.user!.id, keys])).rows;
  const purposeOf = new Map(owned.map((o) => [o.key, o.purpose]));
  if (purposeOf.get(b.idDocumentKey) !== 'kyc_id') throw new HttpError(400, 'Pièce d\'identité manquante ou invalide', 'invalid_document');
  for (const k of Object.values(b.organizationDocKeys)) if (purposeOf.get(k) !== 'kyc_org') throw new HttpError(400, 'Document de l\'organisation invalide', 'invalid_document');
  if (b.type === 'organization' && Object.keys(b.organizationDocKeys).length === 0) throw new HttpError(400, 'Les documents de l\'organisation sont obligatoires', 'invalid_document');
  const phone = normalizePhone(b.payoutPhone);
  try {
    const r = await withTx(req.user!.id, (c) => c.query(
      `INSERT INTO creator_kyc (user_id, type, legal_name, id_document_type, id_document_key, organization_docs, niu, payout_method, payout_phone, payout_account_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [req.user!.id, b.type, b.legalName, b.idDocumentType, b.idDocumentKey, JSON.stringify(b.organizationDocKeys), b.niu ?? null, b.payoutMethod, phone, b.payoutAccountName]));
    res.status(201).json({ kyc: kycPublic(r.rows[0]) });
  } catch (e: any) {
    if (e.code === '23505') throw new HttpError(409, 'Un dossier est déjà en cours d\'examen ou validé', 'kyc_exists');
    throw e;
  }
}));

// ---------- Solde et retraits ----------
async function approvedKyc(userId: string) {
  const k = (await q(`SELECT * FROM creator_kyc WHERE user_id = $1 AND status = 'approved' ORDER BY reviewed_at DESC LIMIT 1`, [userId])).rows[0];
  if (!k) throw new HttpError(403, 'Vérification d\'identité requise avant un retrait', 'kyc_required');
  return k;
}

accountRouter.get('/me/balance', ah(async (req, res) => {
  const uid = req.user!.id;
  const r = (await q(
    `SELECT
       COALESCE((SELECT sum(CASE e.direction WHEN 'credit' THEN e.amount_xaf ELSE -e.amount_xaf END)
                   FROM ledger_entries e JOIN ledger_accounts a ON a.id = e.account_id WHERE a.owner_user_id = $1 AND a.kind = 'liability'), 0) AS total_xaf,
       creator_withdrawable_xaf($1) AS withdrawable_xaf,
       COALESCE((SELECT sum(amount_xaf) FROM payouts WHERE user_id = $1 AND status IN ('requested','processing')), 0) AS in_flight_xaf,
       COALESCE(setting_int('min_payout_xaf'), 5000) AS min_payout_xaf, COALESCE(setting_int('payout_delay_hours'), 72) AS delay_hours,
       (SELECT kyc_status FROM users WHERE id = $1) AS kyc_status`, [uid])).rows[0];
  res.json({ balance: toCamel({ ...r, locked_xaf: Math.max(0, r.total_xaf - r.withdrawable_xaf - r.in_flight_xaf) }) });
}));

accountRouter.get('/payouts', ah(async (req, res) => {
  const r = await q(`SELECT id, amount_xaf, fee_xaf, net_xaf, method, destination_phone_masked, status, failure_reason, requested_at, completed_at
                       FROM payouts WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 50`, [req.user!.id]);
  res.json({ payouts: r.rows.map((x) => toCamel(x)) });
}));

const amountSchema = z.coerce.number().int().min(1).max(100_000_000);
accountRouter.get('/payouts/quote', ah(async (req, res) => {
  const amountXaf = amountSchema.parse(req.query.amountXaf);
  const feeXaf = defaultPayoutProvider().estimatePayoutFee(amountXaf);
  res.json({ amountXaf, feeXaf, netXaf: amountXaf - feeXaf });
}));

// Code de confirmation lié à un retrait précis (montant, frais, destination et méthode).
accountRouter.post('/payouts/otp', ah(async (req, res) => {
  const b = z.object({ amountXaf: z.number().int().min(1), channel: z.enum(['email', 'sms']) }).strict().parse(req.body);
  const k = await approvedKyc(req.user!.id);
  const u = (await q('SELECT email, phone, email_verified_at, phone_verified_at FROM users WHERE id = $1', [req.user!.id])).rows[0];
  const target = b.channel === 'email' ? u?.email : u?.phone;
  const verified = b.channel === 'email' ? u?.email_verified_at : u?.phone_verified_at;
  if (!target || !verified) throw new HttpError(400, 'Ce canal doit être ajouté et vérifié dans les paramètres du compte', 'channel_not_verified');
  const fee = defaultPayoutProvider().estimatePayoutFee(b.amountXaf);
  if (b.amountXaf - fee <= 0) throw new HttpError(400, 'Montant trop faible', 'amount_too_low');
  const challenge = jwt.sign({ sub: req.user!.id, purpose: 'payout', kycId: k.id, amountXaf: b.amountXaf, feeXaf: fee,
    method: k.payout_method, destination: k.payout_phone, channel: b.channel, target }, config.JWT_SECRET, { algorithm: 'HS256', expiresIn: '10m' });
  const code = await withTx(null, (c) => issueOtp(c, 'payout', b.channel, target, req.ip));
  const message = `VOTALLY : code de confirmation du retrait de ${b.amountXaf} FCFA : ${code}. Valable 10 min. Ne le communiquez à personne.`;
  if (b.channel === 'email') await email.send({ to: target, subject: 'VOTALLY — Confirmation de retrait', text: message });
  else await sms.send(target, message);
  res.json({ message: 'Code envoyé', challenge, ...(isProd ? {} : { devCode: code }) });
}));

accountRouter.post('/payouts', ah(async (req, res) => {
  const b = z.object({ amountXaf: z.number().int().min(1), code: z.string().regex(/^\d{6}$/), challenge: z.string() }).strict().parse(req.body);
  let p: jwt.JwtPayload;
  try { p = jwt.verify(b.challenge, config.JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload; }
  catch { throw new HttpError(400, 'Demande de retrait expirée. Recommence.', 'payout_challenge_expired'); }
  if (p.purpose !== 'payout' || p.sub !== req.user!.id || p.amountXaf !== b.amountXaf || typeof p.target !== 'string' ||
      !['email', 'sms'].includes(String(p.channel)) || typeof p.kycId !== 'string' || typeof p.destination !== 'string')
    throw new HttpError(400, 'Les détails du retrait ne correspondent plus à la confirmation', 'payout_challenge_invalid');
  const k = await approvedKyc(req.user!.id);
  if (k.id !== p.kycId || k.payout_phone !== p.destination || k.payout_method !== p.method)
    throw new HttpError(409, 'Les coordonnées de retrait ont changé. Demande un nouveau code.', 'payout_details_changed');
  const channel = p.channel as 'email' | 'sms';
  const u = (await q('SELECT email, phone, email_verified_at, phone_verified_at FROM users WHERE id = $1', [req.user!.id])).rows[0];
  const currentTarget = channel === 'email' ? u.email : u.phone;
  const currentVerified = channel === 'email' ? u.email_verified_at : u.phone_verified_at;
  if (currentTarget !== p.target || !currentVerified) throw new HttpError(409, 'Le canal de confirmation a changé. Demande un nouveau code.', 'payout_channel_changed');
  const provider = defaultPayoutProvider();
  const fee = provider.estimatePayoutFee(b.amountXaf);
  if (fee !== p.feeXaf || b.amountXaf - fee <= 0) throw new HttpError(409, 'Les frais du retrait ont changé. Demande un nouveau code.', 'payout_quote_changed');
  if (!(await consumeOtp('payout', p.target, b.code))) throw new HttpError(400, 'Code invalide ou expiré', 'invalid_code');
  const po = await withTx(req.user!.id, async (c) => (await c.query(
    `INSERT INTO payouts (user_id, kyc_id, amount_xaf, fee_xaf, net_xaf, method, destination_phone_masked, twofa_verified_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now()) RETURNING id`,
    [req.user!.id, k.id, b.amountXaf, fee, b.amountXaf - fee, k.payout_method, k.payout_phone.slice(0, 4) + '** *** *' + k.payout_phone.slice(-2)])).rows[0]);
  const status = await dispatchPayout(po.id);
  res.status(201).json({ payout: { id: po.id, status, amountXaf: b.amountXaf, feeXaf: fee, netXaf: b.amountXaf - fee } });
}));
