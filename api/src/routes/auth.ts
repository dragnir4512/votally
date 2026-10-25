import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { ah, HttpError, toCamel } from '../http.js';
import { q, withTx } from '../db.js';
import { config, isProd } from '../config.js';
import { consumeOtp, endSession, issueOtp, normalizePhone, requireAuth, startSession } from '../security.js';
import { sms } from '../providers.js';

export const authRouter = Router();

const password = z.string().min(8, '8 caractères minimum')
  .regex(/[A-Z]/, 'Au moins une majuscule').regex(/[0-9]/, 'Au moins un chiffre');   // REQ-AUTH-004
const identifier = z.object({ email: z.string().email().optional(), phone: z.string().optional() })
  .refine((v) => !!v.email !== !!v.phone, 'Fournir soit un email, soit un téléphone');

const publicUser = (u: any) => toCamel({
  id: u.id, email: u.email, phone: u.phone, full_name: u.full_name, role: u.role, locale: u.locale,
  kyc_status: u.kyc_status, email_verified_at: u.email_verified_at, phone_verified_at: u.phone_verified_at });

// REQ-AUTH-001/003/005 : inscription, validation obligatoire, consentement horodaté
authRouter.post('/register', ah(async (req, res) => {
  const body = identifier.safeExtend({
    password, fullName: z.string().min(2).max(120), locale: z.enum(['fr', 'en']).default('fr'),
    acceptTerms: z.literal(true, { error: 'Acceptation des CGU obligatoire' }),
    termsVersion: z.string().default('2026-10'),
  }).parse(req.body);

  const email = body.email?.toLowerCase();
  const phone = body.phone ? normalizePhone(body.phone) : undefined;
  const hash = await bcrypt.hash(body.password, config.BCRYPT_COST);

  const code = await withTx(null, async (c) => {
    await c.query(
      `INSERT INTO users (email, phone, password_hash, full_name, locale, terms_version, terms_accepted_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())`, [email ?? null, phone ?? null, hash, body.fullName, body.locale, body.termsVersion]);
    return issueOtp(c, 'signup', email ? 'email' : 'sms', (email ?? phone)!, req.ip);
  });
  if (phone) await sms.send(phone, `VOTALLY : votre code de vérification est ${code}`);
  // TODO Bloc 2b : envoi d'email réel (SendGrid / Mailgun / Brevo)
  res.status(201).json({ message: 'Code de vérification envoyé', ...(isProd ? {} : { devCode: code }) });
}));

// Validation du code -> le compte est vérifié et connecté
authRouter.post('/verify', ah(async (req, res) => {
  const body = identifier.safeExtend({ code: z.string().regex(/^\d{6}$/) }).parse(req.body);
  const email = body.email?.toLowerCase();
  const phone = body.phone ? normalizePhone(body.phone) : undefined;
  if (!(await consumeOtp('signup', (email ?? phone)!, body.code))) throw new HttpError(400, 'Code invalide ou expiré', 'invalid_code');
  const r = await q(
    email ? `UPDATE users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE email = $1 RETURNING *`
          : `UPDATE users SET phone_verified_at = COALESCE(phone_verified_at, now()) WHERE phone = $1 RETURNING *`,
    [email ?? phone]);
  const user = r.rows[0];
  if (!user) throw new HttpError(404, 'Compte introuvable', 'not_found');
  startSession(res, user);
  res.json({ user: publicUser(user) });
}));

authRouter.post('/login', ah(async (req, res) => {
  const body = identifier.safeExtend({ password: z.string().min(1) }).parse(req.body);
  const r = await q(body.email ? 'SELECT * FROM users WHERE email = $1 AND deleted_at IS NULL' : 'SELECT * FROM users WHERE phone = $1 AND deleted_at IS NULL',
    [body.email?.toLowerCase() ?? normalizePhone(body.phone!)]);
  const user = r.rows[0];
  // Même message et même coût de calcul que le compte existe ou non (pas d'énumération)
  const ok = await bcrypt.compare(body.password, user?.password_hash ?? '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvali');
  if (!user || !ok) throw new HttpError(401, 'Identifiants incorrects', 'bad_credentials');
  if (!user.email_verified_at && !user.phone_verified_at) throw new HttpError(403, 'Compte non vérifié : saisis le code reçu', 'unverified');
  startSession(res, user);
  res.json({ user: publicUser(user) });
}));

authRouter.post('/logout', (_req, res) => { endSession(res); res.json({ ok: true }); });

authRouter.get('/me', requireAuth, ah(async (req, res) => {
  const r = await q('SELECT * FROM users WHERE id = $1 AND deleted_at IS NULL', [req.user!.id]);
  if (!r.rows[0]) throw new HttpError(401, 'Session invalide', 'unauthenticated');
  res.json({ user: publicUser(r.rows[0]) });
}));
