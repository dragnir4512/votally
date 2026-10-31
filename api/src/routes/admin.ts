import { Router } from 'express';
import { z } from 'zod';
import { ah, HttpError, toCamel, uuidParam } from '../http.js';
import { q, withTx } from '../db.js';
import { requireAdmin } from '../security.js';
import { isValidKey, storage } from '../storage.js';

export const adminRouter = Router();
adminRouter.use(requireAdmin);

adminRouter.get('/overview', ah(async (_req, res) => {
  const r = (await q(
    `SELECT (SELECT count(*) FROM creator_kyc WHERE status = 'pending') AS pending_kyc,
            (SELECT count(*) FROM fraud_flags WHERE status = 'open') AS open_fraud_flags,
            (SELECT count(*) FROM payments WHERE needs_refund) AS refunds_due,
            (SELECT count(*) FROM webhook_events WHERE processed_at IS NULL) AS unprocessed_webhooks,
            (SELECT count(*) FROM payouts WHERE status IN ('requested','processing')) AS payouts_in_flight,
            (SELECT count(*) FROM payouts WHERE status = 'failed' AND requested_at > now() - interval '7 days') AS payouts_failed_7d,
            (SELECT count(*) FROM contests WHERE status = 'active') AS active_contests,
            (SELECT imbalance_xaf FROM ledger_integrity) AS ledger_imbalance_xaf`)).rows[0];
  res.json({ overview: toCamel(r) });
}));

// ---------- KYC ----------
adminRouter.get('/kyc', ah(async (req, res) => {
  const status = z.enum(['pending', 'approved', 'rejected']).default('pending').parse(req.query.status);
  const r = await q(
    `SELECT k.id, k.type, k.legal_name, k.status, k.submitted_at, k.reviewed_at, u.full_name, u.email, u.phone
       FROM creator_kyc k JOIN users u ON u.id = k.user_id WHERE k.status = $1 ORDER BY k.submitted_at LIMIT 100`, [status]);
  res.json({ items: r.rows.map((x) => toCamel(x)) });
}));

adminRouter.get('/kyc/:id', ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  const k = (await q(`SELECT k.*, u.full_name, u.email, u.phone FROM creator_kyc k JOIN users u ON u.id = k.user_id WHERE k.id = $1`, [id])).rows[0];
  if (!k) throw new HttpError(404, 'Dossier introuvable', 'not_found');
  const documents = [{ label: k.id_document_type === 'cni' ? 'Carte nationale d\'identité' : 'Passeport', key: k.id_document_key },
    ...Object.entries(k.organization_docs as Record<string, string>).map(([label, key]) => ({ label, key }))];
  res.json({ kyc: toCamel({ ...k, organization_docs: undefined, id_document_key: undefined }), documents });
}));

adminRouter.post('/kyc/:id/approve', ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  // L'administrateur doit confirmer explicitement que le titulaire du compte Mobile Money correspond à l'identité vérifiée
  z.object({ nameChecked: z.literal(true, { error: 'Confirme que le nom du compte correspond à l\'identité' }) }).parse(req.body);
  const r = await withTx(req.user!.id, (c) => c.query(
    `UPDATE creator_kyc SET status = 'approved', reviewed_by = $2, reviewed_at = now(), rejection_reason = NULL WHERE id = $1 AND status = 'pending' RETURNING id`, [id, req.user!.id]));
  if (!r.rows[0]) throw new HttpError(409, 'Dossier introuvable ou déjà traité', 'not_pending');
  res.json({ ok: true });
}));

adminRouter.post('/kyc/:id/reject', ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  const b = z.object({ reason: z.string().trim().min(5).max(500) }).parse(req.body);
  const r = await withTx(req.user!.id, (c) => c.query(
    `UPDATE creator_kyc SET status = 'rejected', reviewed_by = $2, reviewed_at = now(), rejection_reason = $3 WHERE id = $1 AND status = 'pending' RETURNING id`, [id, req.user!.id, b.reason]));
  if (!r.rows[0]) throw new HttpError(409, 'Dossier introuvable ou déjà traité', 'not_pending');
  res.json({ ok: true });
}));

/** Consultation d'une pièce privée : réservée aux administrateurs, jamais mise en cache, et journalisée. */
adminRouter.get('/files/:key', ah(async (req, res) => {
  const key = req.params.key as string;
  if (!isValidKey(key)) throw new HttpError(404, 'Fichier introuvable', 'not_found');
  const meta = (await q('SELECT content_type FROM uploads WHERE key = $1', [key])).rows[0];
  const data = meta ? await storage.get(key) : null;
  if (!meta || !data) throw new HttpError(404, 'Fichier introuvable', 'not_found');
  await q(`SELECT audit($1, 'admin', 'file.view', 'upload', $2)`, [req.user!.id, key]);
  res.set({ 'Content-Type': meta.content_type, 'Content-Disposition': 'inline', 'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self' data:" }).send(data);
}));

// ---------- Remboursements ----------
adminRouter.get('/refunds', ah(async (_req, res) => {
  const r = await q(
    `SELECT p.id, p.provider, p.method, p.amount_xaf, p.provider_reference, p.initiated_at, o.reference AS order_reference, c.name AS contest_name
       FROM payments p JOIN vote_orders o ON o.id = p.order_id JOIN contests c ON c.id = o.contest_id
      WHERE p.needs_refund ORDER BY p.initiated_at LIMIT 100`);
  res.json({ items: r.rows.map((x) => toCamel(x)) });
}));

// À appeler APRÈS avoir remboursé le votant chez l'agrégateur : passe l'écriture inverse et invalide les votes.
adminRouter.post('/payments/:id/refund', ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  const b = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body);
  await withTx(req.user!.id, (c) => c.query('SELECT refund_payment($1, $2, $3)', [id, req.user!.id, b.reason]));
  res.json({ ok: true });
}));

// ---------- Concours : recherche et gel des fonds ----------
adminRouter.get('/contests', ah(async (req, res) => {
  const term = z.string().max(80).default('').parse(req.query.q ?? '');
  const r = await q(
    `SELECT c.id, c.name, c.slug, c.status, c.vote_type, c.payout_frozen_at, c.payout_frozen_reason, u.email AS owner_email, u.full_name AS owner_name,
            (SELECT COALESCE(sum(valid_votes), 0) FROM candidate_vote_counts WHERE contest_id = c.id) AS total_votes
       FROM contests c JOIN users u ON u.id = c.owner_id
      WHERE ($1 = '' OR c.name ILIKE '%' || $1 || '%' OR c.slug ILIKE '%' || $1 || '%') ORDER BY c.created_at DESC LIMIT 50`, [term]);
  res.json({ items: r.rows.map((x) => toCamel(x)) });
}));

adminRouter.post('/contests/:id/freeze', ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  const b = z.object({ reason: z.string().trim().min(5).max(300) }).parse(req.body);
  const r = await withTx(req.user!.id, (c) => c.query('UPDATE contests SET payout_frozen_at = now(), payout_frozen_reason = $2 WHERE id = $1 RETURNING id', [id, b.reason]));
  if (!r.rows[0]) throw new HttpError(404, 'Concours introuvable', 'not_found');
  res.json({ ok: true });
}));
adminRouter.post('/contests/:id/unfreeze', ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  const r = await withTx(req.user!.id, (c) => c.query('UPDATE contests SET payout_frozen_at = NULL, payout_frozen_reason = NULL WHERE id = $1 RETURNING id', [id]));
  if (!r.rows[0]) throw new HttpError(404, 'Concours introuvable', 'not_found');
  res.json({ ok: true });
}));

// ---------- Fraude ----------
adminRouter.get('/fraud', ah(async (req, res) => {
  const status = z.enum(['open', 'confirmed', 'dismissed']).default('open').parse(req.query.status);
  const r = await q(
    `SELECT f.id, f.rule, f.score, f.details, f.status, f.created_at, f.order_id, f.vote_id, c.name AS contest_name, c.id AS contest_id
       FROM fraud_flags f JOIN contests c ON c.id = f.contest_id WHERE f.status = $1 ORDER BY f.score DESC, f.created_at LIMIT 100`, [status]);
  res.json({ items: r.rows.map((x) => toCamel(x)) });
}));
adminRouter.post('/fraud/:id/review', ah(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const b = z.object({ status: z.enum(['confirmed', 'dismissed']) }).parse(req.body);
  const r = await q(`UPDATE fraud_flags SET status = $2, reviewed_by = $3, reviewed_at = now() WHERE id = $1 AND status = 'open' RETURNING id`, [id, b.status, req.user!.id]);
  if (!r.rows[0]) throw new HttpError(404, 'Alerte introuvable ou déjà traitée', 'not_found');
  res.json({ ok: true });
}));
adminRouter.post('/votes/:id/invalidate', ah(async (req, res) => {
  const id = z.coerce.number().int().positive().parse(req.params.id);
  const b = z.object({ reason: z.string().trim().min(5).max(300) }).parse(req.body);
  await withTx(req.user!.id, (c) => c.query('SELECT invalidate_vote($1, $2, $3)', [id, req.user!.id, b.reason]));
  res.json({ ok: true });
}));

// ---------- Retraits à surveiller ----------
adminRouter.get('/payouts', ah(async (_req, res) => {
  const r = await q(
    `SELECT p.id, p.amount_xaf, p.fee_xaf, p.net_xaf, p.method, p.status, p.failure_reason, p.requested_at, u.full_name, u.email
       FROM payouts p JOIN users u ON u.id = p.user_id
      WHERE p.status IN ('requested','processing','failed') ORDER BY p.requested_at DESC LIMIT 100`);
  res.json({ items: r.rows.map((x) => toCamel(x)) });
}));
