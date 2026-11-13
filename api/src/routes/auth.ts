import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { ah, HttpError, toCamel, uuidParam } from '../http.js';
import { q, withTx } from '../db.js';
import { config, isProd } from '../config.js';
import { consumeOtp, clearSessionCookies, issueOtp, listSessions, normalizePhone, refreshSession, requireAuth, revokeAllSessions, revokeSession, revokeSessionById, startSession } from '../security.js';
import { sms } from '../providers.js';

export const authRouter = Router();

const password = z.string().min(8, '8 caractères minimum')
  .regex(/[A-Z]/, 'Au moins une majuscule').regex(/[0-9]/, 'Au moins un chiffre');
const identifier = z.object({ email: z.string().email().optional(), phone: z.string().optional() })
  .refine((v) => !!v.email !== !!v.phone, 'Fournir soit un email, soit un téléphone');
const publicUser = (u: any) => toCamel({
  id: u.id, email: u.email, phone: u.phone, full_name: u.full_name, role: u.role, locale: u.locale,
  kyc_status: u.kyc_status, account_status: u.account_status, account_status_reason: u.account_status_reason,
  email_verified_at: u.email_verified_at, phone_verified_at: u.phone_verified_at });

authRouter.post('/register', ah(async (req, res) => {
  const body = identifier.safeExtend({
    password, fullName: z.string().min(2).max(120), locale: z.enum(['fr', 'en']).default('fr'),
    acceptTerms: z.literal(true, { error: 'Acceptation des CGU obligatoire' }),
    termsVersion: z.string().default('2026-10'),
  }).parse(req.body);
  const email = body.email?.toLowerCase(), phone = body.phone ? normalizePhone(body.phone) : undefined;
  const hash = await bcrypt.hash(body.password, config.BCRYPT_COST);
  const code = await withTx(null, async (c) => {
    await c.query(`INSERT INTO users (email, phone, password_hash, full_name, locale, terms_version, terms_accepted_at)
      VALUES ($1, $2, $3, $4, $5, $6, now())`, [email ?? null, phone ?? null, hash, body.fullName, body.locale, body.termsVersion]);
    return issueOtp(c, 'signup', email ? 'email' : 'sms', (email ?? phone)!, req.ip);
  });
  if (phone) await sms.send(phone, `VOTALLY : votre code de vérification est ${code}`);
  res.status(201).json({ message: 'Code de vérification envoyé', ...(isProd ? {} : { devCode: code }) });
}));

authRouter.post('/verify', ah(async (req, res) => {
  const body = identifier.safeExtend({ code: z.string().regex(/^\\d{6}$/) }).parse(req.body);
  const email = body.email?.toLowerCase(), phone = body.phone ? normalizePhone(body.phone) : undefined;
  const existing = (await q(email
    ? 'SELECT id, account_status FROM users WHERE email = $1 AND deleted_at IS NULL'
    : 'SELECT id, account_status FROM users WHERE phone = $1 AND deleted_at IS NULL', [email ?? phone])).rows[0];
  if (!existing) throw new HttpError(404, 'Compte introuvable', 'not_found');
  if (existing.account_status !== 'active') throw new HttpError(403, 'Ce compte est suspendu ou désactivé', 'account_unavailable');
  if (!(await consumeOtp('signup', (email ?? phone)!, body.code))) throw new HttpError(400, 'Code invalide ou expiré', 'invalid_code');
  const r = await q(email
    ? 'UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE email = $1 AND deleted_at IS NULL RETURNING *'
    : 'UPDATE users SET phone_verified_at = COALESCE(phone_verified_at, now()) WHERE phone = $1 AND deleted_at IS NULL RETURNING *', [email ?? phone]);
  const user = r.rows[0];
  if (!user) throw new HttpError(404, 'Compte introuvable', 'not_found');
  await startSession(req, res, user);
  res.json({ user: publicUser(user) });
}));

authRouter.post('/login', ah(async (req, res) => {
  const body = identifier.safeExtend({ password: z.string().min(1) }).parse(req.body);
  const r = await q(body.email
    ? 'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL'
    : 'SELECT * FROM users WHERE phone = $1 AND deleted_at IS NULL',
    [body.email?.toLowerCase() ?? normalizePhone(body.phone!)]);
  const user = r.rows[0];
  const ok = await bcrypt.compare(body.password, user?.password_hash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
  if (!user || !ok) throw new HttpError(401, 'Identifiants incorrects', 'bad_credentials');
  if (user.account_status !== 'active') throw new HttpError(403, 'Ce compte est suspendu ou désactivé', 'account_unavailable');
  if (!user.email_verified_at && !user.phone_verified_at) throw new HttpError(403, 'Compte non vérifié : saisis le code reçu', 'unverified');
  await startSession(req, res, user);
  res.json({ user: publicUser(user) });
}));

// Renouvellement avec rotation du jeton opaque : chaque ancien refresh token ne peut servir qu'une fois.
authRouter.post('/refresh', ah(async (req, res) => { res.json(await refreshSession(req, res)); }));

authRouter.post('/logout', ah(async (req, res) => {
  const refresh = req.cookies?.votally_refresh;
  if (typeof refresh === 'string') {
    const { sha256 } = await import('../security.js');
    await q(`UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, now()), revoke_reason = COALESCE(revoke_reason, 'user_logout')
      WHERE refresh_token_hash = $1 AND revoked_at IS NULL`, [sha256(refresh)]);
  }
  clearSessionCookies(res);
  res.json({ ok: true });
}));

authRouter.get('/me', requireAuth, ah(async (req, res) => {
  const r = await q('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [req.user!.id]);
  if (!r.rows[0]) throw new HttpError(401, 'Session invalide', 'unauthenticated');
  res.json({ user: publicUser(r.rows[0]) });
}));

// Appareils connectés : seules les sessions du compte courant sont visibles et révocables.
authRouter.get('/sessions', requireAuth, ah(async (req, res) => {
  const sessions = await listSessions(req.user!.id, req.user!.sessionId);
  res.json({ sessions: sessions.map((s) => toCamel(s)) });
}));
authRouter.delete('/sessions/:id', requireAuth, ah(async (req, res) => {
  const id = uuidParam(req, 'id');
  await revokeSessionById(id, req.user!.id);
  if (id === req.user!.sessionId) clearSessionCookies(res);
  res.json({ ok: true });
}));
authRouter.post('/sessions/revoke-others', requireAuth, ah(async (req, res) => {
  await revokeAllSessions(req.user!.id, req.user!.sessionId);
  res.json({ ok: true });
}));
authRouter.post('/sessions/revoke-all', requireAuth, ah(async (req, res) => {
  await revokeAllSessions(req.user!.id);
  clearSessionCookies(res);
  res.json({ ok: true });
}));
