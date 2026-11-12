import { Router } from 'express';
import { z } from 'zod';
import { ah, HttpError, toCamel } from '../http.js';
import { q, withTx } from '../db.js';
import { consumeOtp, issueOtp, normalizePhone, requireAuth } from '../security.js';
import { defaultPayoutProvider, sms } from '../providers.js';
import { dispatchPayout } from '../payouts.js';
import { isProd } from '../config.js';
import { sniffDocument } from '../images.js';
import { bodyBuffer, checkQuota, rawFile, storeFile } from './media.js';

export const accountRouter = Router();
accountRouter.use(['/me', '/payouts'], requireAuth);

const kycPublic = (r: any) => r && toCamel({
  id: r.id, type: r.type, legal_name: r.legal_name, id_document_type: r.id_document_type, niu: r.niu, payout_method: r.payout_method,
  payout_phone_masked: r.payout_phone.slice(0, 4) + '** *** *' + r.payout_phone.slice(-2), payout_account_name: r.payout_account_name,
  status: r.status, rejection_reason: r.rejection_reason, submitted_at: r.submitted_at, reviewed_at: r.reviewed_at });

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

// Double authentification : code SMS envoyé au numéro Mobile Money vérifié par le KYC
accountRouter.post('/payouts/otp', ah(async (req, res) => {
  const k = await approvedKyc(req.user!.id);
  const code = await withTx(null, (c) => issueOtp(c, 'payout', 'sms', k.payout_phone, req.ip));
  await sms.send(k.payout_phone, `VOTALLY : code de confirmation de retrait ${code} (valable 10 min). Ne le communiquez à personne.`);
  res.json({ message: 'Code envoyé par SMS', ...(isProd ? {} : { devCode: code }) });
}));

accountRouter.post('/payouts', ah(async (req, res) => {
  const b = z.object({ amountXaf: z.number().int().min(1), code: z.string().regex(/^\d{6}$/) }).parse(req.body);
  const k = await approvedKyc(req.user!.id);
  const provider = defaultPayoutProvider();
  const fee = provider.estimatePayoutFee(b.amountXaf);
  if (b.amountXaf - fee <= 0) throw new HttpError(400, 'Montant trop faible', 'amount_too_low');
  if (!(await consumeOtp('payout', k.payout_phone, b.code))) throw new HttpError(400, 'Code invalide ou expiré', 'invalid_code');

  // Solde, seuil, délai de sécurité, gel des fonds et KYC sont contrôlés par la base (trigger payouts_before_insert)
  const po = await withTx(req.user!.id, async (c) => (await c.query(
    `INSERT INTO payouts (user_id, kyc_id, amount_xaf, fee_xaf, net_xaf, method, destination_phone_masked, twofa_verified_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, now()) RETURNING id`,
    [req.user!.id, k.id, b.amountXaf, fee, b.amountXaf - fee, k.payout_method, k.payout_phone.slice(0, 4) + '** *** *' + k.payout_phone.slice(-2)])).rows[0]);

  const status = await dispatchPayout(po.id);
  res.status(201).json({ payout: { id: po.id, status, amountXaf: b.amountXaf, feeXaf: fee, netXaf: b.amountXaf - fee } });
}));
