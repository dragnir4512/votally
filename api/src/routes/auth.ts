import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { ah, HttpError, toCamel, uuidParam } from '../http.js';
import { q, withTx } from '../db.js';
import { config, isProd } from '../config.js';
import { consumeOtp, clearSessionCookies, issueOtp, listSessions, normalizePhone, refreshSession, requireAuth, revokeAllSessions, revokeSessionById, sha256, startSession } from '../security.js';
import { email, sms } from '../providers.js';

export const authRouter = Router();

const password = z.string().min(10, '10 caractères minimum')
  .regex(/[a-z]/, 'Au moins une minuscule')
  .regex(/[A-Z]/, 'Au moins une majuscule')
  .regex(/[0-9]/, 'Au moins un chiffre');
const identifier = z.object({ email: z.string().trim().email().transform((value) => value.toLowerCase()).optional(), phone: z.string().optional() })
  .refine((v) => !!v.email !== !!v.phone, 'Fournir soit un email, soit un téléphone');
const publicUser = (u: any) => toCamel({
  id: u.id, email: u.email, phone: u.phone, full_name: u.full_name, role: u.role, locale: u.locale,
  kyc_status: u.kyc_status, account_status: u.account_status, account_status_reason: u.account_status_reason,
  email_verified_at: u.email_verified_at, phone_verified_at: u.phone_verified_at });

async function deliverCode(channel: 'email' | 'sms', target: string, code: string, purpose: 'signup' | 'password_reset') {
  const label = purpose === 'signup' ? 'validation de votre compte' : 'réinitialisation de votre mot de passe';
  const message = `Votre code VOTALLY pour la ${label} est : ${code}. Il expire dans 10 minutes. Ne le communiquez à personne.`;
  if (channel === 'email') await email.send({ to: target, subject: purpose === 'signup' ? 'VOTALLY — Vérification du compte' : 'VOTALLY — Réinitialisation du mot de passe', text: message });
  else await sms.send(target, message);
}
const genericRecoveryMessage = 'Si un compte vérifié correspond à ces informations, un code vient d’être envoyé.';

authRouter.post('/register', ah(async (req, res) => {
  const body = identifier.safeExtend({
    password, fullName: z.string().min(2).max(120), locale: z.enum(['fr', 'en']).default('fr'),
    acceptTerms: z.literal(true, { error: 'Acceptation des CGU obligatoire' }),
    termsVersion: z.string().default('2026-10'),
  }).parse(req.body);
  const emailAddress = body.email?.toLowerCase(), phone = body.phone ? normalizePhone(body.phone) : undefined;
  const hash = await bcrypt.hash(body.password, config.BCRYPT_COST);
  const target = emailAddress ?? phone!;
  const channel = emailAddress ? 'email' : 'sms';
  const code = await withTx(null, async (c) => {
    await c.query(`INSERT INTO users (email, phone, password_hash, full_name, locale, terms_version, terms_accepted_at)
      VALUES ($1, $2, $3, $4, $5, $6, now())`, [emailAddress ?? null, phone ?? null, hash, body.fullName, body.locale, body.termsVersion]);
    return issueOtp(c, 'signup', channel, target, req.ip);
  });
  await deliverCode(channel, target, code, 'signup');
  res.status(201).json({ message: 'Code de vérification envoyé', ...(isProd ? {} : { devCode: code }) });
}));

authRouter.post('/verify', ah(async (req, res) => {
  const body = identifier.safeExtend({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);
  const emailAddress = body.email?.toLowerCase(), phone = body.phone ? normalizePhone(body.phone) : undefined;
  const existing = (await q(emailAddress
    ? 'SELECT id, account_status FROM users WHERE email = $1 AND deleted_at IS NULL'
    : 'SELECT id, account_status FROM users WHERE phone = $1 AND deleted_at IS NULL', [emailAddress ?? phone])).rows[0];
  if (!existing) throw new HttpError(400, 'Code invalide ou expiré', 'invalid_code');
  if (existing.account_status !== 'active') throw new HttpError(403, 'Ce compte est suspendu ou désactivé', 'account_unavailable');
  if (!(await consumeOtp('signup', (emailAddress ?? phone)!, body.code))) throw new HttpError(400, 'Code invalide ou expiré', 'invalid_code');
  const r = await q(emailAddress
    ? 'UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE email = $1 AND deleted_at IS NULL RETURNING *'
    : 'UPDATE users SET phone_verified_at = COALESCE(phone_verified_at, now()) WHERE phone = $1 AND deleted_at IS NULL RETURNING *', [emailAddress ?? phone]);
  const user = r.rows[0];
  if (!user) throw new HttpError(404, 'Compte introuvable', 'not_found');
  await startSession(req, res, user);
  res.json({ user: publicUser(user) });
}));

authRouter.post('/resend-code', ah(async (req, res) => {
  const body = identifier.parse(req.body);
  const emailAddress = body.email?.toLowerCase(), phone = body.phone ? normalizePhone(body.phone) : undefined;
  const channel = emailAddress ? 'email' : 'sms', target = emailAddress ?? phone!;
  const user = (await q(emailAddress
    ? 'SELECT email_verified_at AS verified, account_status FROM users WHERE email = $1 AND deleted_at IS NULL'
    : 'SELECT phone_verified_at AS verified, account_status FROM users WHERE phone = $1 AND deleted_at IS NULL', [target])).rows[0];
  if (!user || user.verified || user.account_status !== 'active') return res.json({ message: genericRecoveryMessage });
  let code: string;
  try { code = await withTx(null, (c) => issueOtp(c, 'signup', channel, target, req.ip)); }
  catch (error) { if (error instanceof HttpError && error.code === 'otp_throttled') return res.json({ message: genericRecoveryMessage }); throw error; }
  try { await deliverCode(channel, target, code, 'signup'); }
  catch (error) { console.error('[auth] resend delivery failed', error); return res.json({ message: genericRecoveryMessage }); }
  res.json({ message: genericRecoveryMessage, ...(isProd ? {} : { devCode: code }) });
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

authRouter.post('/password/forgot', ah(async (req, res) => {
  const body = identifier.parse(req.body);
  const emailAddress = body.email?.toLowerCase(), phone = body.phone ? normalizePhone(body.phone) : undefined;
  const channel = emailAddress ? 'email' : 'sms', target = emailAddress ?? phone!;
  const user = (await q(emailAddress
    ? 'SELECT id, email_verified_at AS verified, account_status FROM users WHERE email = $1 AND deleted_at IS NULL'
    : 'SELECT id, phone_verified_at AS verified, account_status FROM users WHERE phone = $1 AND deleted_at IS NULL', [target])).rows[0];
  if (!user || !user.verified || user.account_status !== 'active') return res.json({ message: genericRecoveryMessage });
  let code: string;
  try { code = await withTx(null, (c) => issueOtp(c, 'password_reset', channel, target, req.ip)); }
  catch (error) { if (error instanceof HttpError && error.code === 'otp_throttled') return res.json({ message: genericRecoveryMessage }); throw error; }
  try { await deliverCode(channel, target, code, 'password_reset'); }
  catch (error) { console.error('[auth] password recovery delivery failed', error); return res.json({ message: genericRecoveryMessage }); }
  res.json({ message: genericRecoveryMessage, ...(isProd ? {} : { devCode: code }) });
}));

authRouter.post('/password/reset', ah(async (req, res) => {
  const body = identifier.safeExtend({ code: z.string().regex(/^\d{6}$/), newPassword: password }).parse(req.body);
  const emailAddress = body.email?.toLowerCase(), phone = body.phone ? normalizePhone(body.phone) : undefined;
  const target = emailAddress ?? phone!;
  const user = (await q(emailAddress
    ? 'SELECT id, account_status, email_verified_at AS verified FROM users WHERE email = $1 AND deleted_at IS NULL'
    : 'SELECT id, account_status, phone_verified_at AS verified FROM users WHERE phone = $1 AND deleted_at IS NULL', [target])).rows[0];
  if (!user || !user.verified || user.account_status !== 'active') throw new HttpError(400, 'Code invalide ou expiré', 'invalid_code');
  if (!(await consumeOtp('password_reset', target, body.code))) throw new HttpError(400, 'Code invalide ou expiré', 'invalid_code');
  const hash = await bcrypt.hash(body.newPassword, config.BCRYPT_COST);
  await withTx(user.id, async (c) => {
    await c.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, hash]);
    await c.query(`UPDATE user_sessions SET revoked_at = now(), revoke_reason = 'password_reset'
      WHERE user_id = $1 AND revoked_at IS NULL`, [user.id]);
  });
  clearSessionCookies(res);
  res.json({ message: 'Mot de passe modifié. Connectez-vous avec votre nouveau mot de passe.' });
}));

authRouter.post('/refresh', ah(async (req, res) => { res.json(await refreshSession(req, res)); }));

authRouter.post('/logout', ah(async (req, res) => {
  const refresh = req.cookies?.votally_refresh;
  if (typeof refresh === 'string') {
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
