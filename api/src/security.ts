import { createHash, randomInt, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config, isProd } from './config.js';
import { HttpError } from './http.js';
import type { Db } from './db.js';
import { q, withTx } from './db.js';

declare global {
  namespace Express { interface Request { user?: { id: string; role: 'creator' | 'admin' } } }
}

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest();

// ---------- Téléphones ----------
/** Accepte 6XXXXXXXX, 2376XXXXXXXX, +2376XXXXXXXX et tout numéro E.164 valide. */
export function normalizePhone(input: string): string {
  const raw = input.replace(/[\s().-]/g, '');
  let p = raw;
  if (/^[62]\d{8}$/.test(raw)) p = '+237' + raw;            // numéro camerounais local (9 chiffres)
  else if (/^237\d{9}$/.test(raw)) p = '+' + raw;
  else if (/^00/.test(raw)) p = '+' + raw.slice(2);
  if (!/^\+[1-9]\d{7,14}$/.test(p)) throw new HttpError(400, 'Numéro de téléphone invalide', 'invalid_phone');
  return p;
}
/** Haché (avec poivre) : sert à détecter les doublons sans stocker le numéro en clair. */
export const hashTarget = (target: string): Buffer => sha256(target.toLowerCase() + config.PHONE_HASH_PEPPER);
export function maskPhone(p: string): string {
  if (p.startsWith('+237') && p.length === 13) return `+237 ${p[4]}** *** *${p.slice(-2)}`;
  return `${p.slice(0, 4)}** *** *${p.slice(-2)}`;
}

// ---------- Codes à usage unique ----------
const hashCode = (code: string, target: Buffer) => sha256(code + config.PHONE_HASH_PEPPER + target.toString('hex'));

/** Émet un code (6 chiffres). Un nouveau code par minute au maximum et par cible. */
export async function issueOtp(c: Db, purpose: string, channel: 'sms' | 'email', target: string, ip?: string): Promise<string> {
  const th = hashTarget(target);
  // Sérialise les demandes simultanées pour la même cible : le SELECT + INSERT doit être atomique.
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || encode($2, 'hex'), 0))", [purpose, th]);
  const last = await c.query('SELECT created_at FROM otp_codes WHERE purpose = $1 AND target_hash = $2 ORDER BY created_at DESC LIMIT 1', [purpose, th]);
  if (last.rows[0] && Date.now() - new Date(last.rows[0].created_at).getTime() < 60_000) {
    throw new HttpError(429, 'Patiente 60 secondes avant de redemander un code', 'otp_throttled');
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await c.query(
    `INSERT INTO otp_codes (purpose, channel, target_hash, code_hash, expires_at, ip)
     VALUES ($1, $2, $3, $4, now() + make_interval(mins => COALESCE(setting_int('otp_ttl_minutes'), 10)::int), $5)`,
    [purpose, channel, th, hashCode(code, th), ip ?? null]);
  return code;
}

/** Vérifie et consomme un code dans SA PROPRE transaction : un essai raté doit rester compté même si l'appelant échoue ensuite. */
export async function consumeOtp(purpose: string, target: string, code: string): Promise<boolean> {
  const th = hashTarget(target);
  return withTx(null, async (c) => {
    const r = await c.query(
      `SELECT id, code_hash, attempts, max_attempts FROM otp_codes
        WHERE purpose = $1 AND target_hash = $2 AND consumed_at IS NULL AND expires_at > now()
        ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [purpose, th]);
    const row = r.rows[0];
    if (!row || row.attempts >= row.max_attempts) return false;
    const expected: Buffer = row.code_hash;
    const given = hashCode(code, th);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      await c.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
      return false;
    }
    await c.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [row.id]);
    return true;
  });
}

// ---------- Session ----------
const COOKIE = 'votally_session';
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;   // REQ-AUTH-012 : 30 jours

export function startSession(res: Response, user: { id: string; role: string }) {
  const token = jwt.sign({ sub: user.id, role: user.role }, config.JWT_SECRET, { expiresIn: '30d' });
  res.cookie(COOKIE, token, { httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: MAX_AGE_MS, path: '/' });
}
export const endSession = (res: Response) => { res.clearCookie(COOKIE, { path: '/' }); };

function readToken(req: Request): string | undefined {
  const bearer = req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];   // pratique pour Bruno / Postman
  return req.cookies?.[COOKIE] ?? bearer;
}
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) return next(new HttpError(401, 'Connexion requise', 'unauthenticated'));
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET) as jwt.JwtPayload;
  } catch {
    return next(new HttpError(401, 'Session expirée', 'unauthenticated'));
  }
  const userId = String(payload.sub ?? '');
  if (!userId) return next(new HttpError(401, 'Session invalide', 'unauthenticated'));
  // Le rôle et l'état du compte viennent de la base, jamais des seules claims du JWT.
  q('SELECT role, account_status FROM users WHERE id = $1 AND deleted_at IS NULL', [userId])
    .then((r) => {
      const user = r.rows[0];
      if (!user) return next(new HttpError(401, 'Session invalide', 'unauthenticated'));
      if (user.account_status !== 'active') return next(new HttpError(403, 'Ce compte est suspendu ou désactivé', 'account_unavailable'));
      req.user = { id: userId, role: user.role === 'admin' ? 'admin' : 'creator' };
      next();
    })
    .catch(next);
}
/** Le rôle est relu en base à chaque requête : retirer le rôle administrateur est immédiat (pas d'attente de l'expiration du jeton). */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, (err?: any) => {
    if (err) return next(err);
    q('SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL', [req.user!.id])
      .then((r) => (r.rows[0]?.role === 'admin' ? next() : next(new HttpError(403, 'Réservé aux administrateurs', 'forbidden'))))
      .catch(next);
  });
}
export const randomToken = () => randomBytes(24).toString('base64url');
