import { createHash, randomInt, randomBytes, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config, isProd } from './config.js';
import { HttpError } from './http.js';
import type { Db } from './db.js';
import { q, withTx } from './db.js';

declare global {
  namespace Express { interface Request { user?: { id: string; role: 'creator' | 'admin'; sessionId: string } } }
}

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest();

// ---------- Téléphones ----------
/** Accepte 6XXXXXXXX, 2376XXXXXXXX, +2376XXXXXXXX et tout numéro E.164 valide. */
export function normalizePhone(input: string): string {
  const raw = input.replace(/[\s().-]/g, '');
  let p = raw;
  if (/^[62]\d{8}$/.test(raw)) p = '+237' + raw;
  else if (/^237\d{9}$/.test(raw)) p = '+' + raw;
  else if (/^00/.test(raw)) p = '+' + raw.slice(2);
  if (!/^\+[1-9]\d{7,14}$/.test(p)) throw new HttpError(400, 'Numéro de téléphone invalide', 'invalid_phone');
  return p;
}
export const hashTarget = (target: string): Buffer => sha256(target.toLowerCase() + config.PHONE_HASH_PEPPER);
export function maskPhone(p: string): string {
  if (p.startsWith('+237') && p.length === 13) return `+237 ${p[4]}** *** *${p.slice(-2)}`;
  return `${p.slice(0, 4)}** *** *${p.slice(-2)}`;
}

// ---------- Codes à usage unique ----------
const hashCode = (code: string, target: Buffer) => sha256(code + config.PHONE_HASH_PEPPER + target.toString('hex'));
export async function issueOtp(c: Db, purpose: string, channel: 'sms' | 'email', target: string, ip?: string): Promise<string> {
  const th = hashTarget(target);
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || encode($2, 'hex'), 0))", [purpose, th]);
  const last = await c.query('SELECT created_at FROM otp_codes WHERE purpose = $1 AND target_hash = $2 ORDER BY created_at DESC LIMIT 1', [purpose, th]);
  if (last.rows[0] && Date.now() - new Date(last.rows[0].created_at).getTime() < 60_000) throw new HttpError(429, 'Patiente 60 secondes avant de redemander un code', 'otp_throttled');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await c.query(`INSERT INTO otp_codes (purpose, channel, target_hash, code_hash, expires_at, ip)
     VALUES ($1, $2, $3, $4, now() + make_interval(mins => COALESCE(setting_int('otp_ttl_minutes'), 10)::int), $5)`,
    [purpose, channel, th, hashCode(code, th), ip ?? null]);
  return code;
}
export async function consumeOtp(purpose: string, target: string, code: string): Promise<boolean> {
  const th = hashTarget(target);
  return withTx(null, async (c) => {
    const r = await c.query(`SELECT id, code_hash, attempts, max_attempts FROM otp_codes
      WHERE purpose = $1 AND target_hash = $2 AND consumed_at IS NULL AND expires_at > now()
      ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [purpose, th]);
    const row = r.rows[0];
    if (!row || row.attempts >= row.max_attempts) return false;
    const expected: Buffer = row.code_hash, given = hashCode(code, th);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      await c.query('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
      return false;
    }
    await c.query('UPDATE otp_codes SET consumed_at = now() WHERE id = $1', [row.id]);
    return true;
  });
}

// ---------- Sessions serveur révocables ----------
const ACCESS_COOKIE = 'votally_session';
const REFRESH_COOKIE = 'votally_refresh';
const ACCESS_TTL_SECONDS = 15 * 60;
const REFRESH_TTL_DAYS = 30;
const REFRESH_TTL_MS = REFRESH_TTL_DAYS * 24 * 3600 * 1000;
const cookieOptions = { httpOnly: true, secure: isProd, sameSite: 'lax' as const, path: '/' };

function setAccessCookie(res: Response, user: { id: string; role: string }, sessionId: string) {
  const token = jwt.sign({ sub: user.id, role: user.role, sid: sessionId }, config.JWT_SECRET, { algorithm: 'HS256', expiresIn: ACCESS_TTL_SECONDS });
  res.cookie(ACCESS_COOKIE, token, { ...cookieOptions, maxAge: ACCESS_TTL_SECONDS * 1000 });
}
function setRefreshCookie(res: Response, token: string) {
  res.cookie(REFRESH_COOKIE, token, { ...cookieOptions, maxAge: REFRESH_TTL_MS });
}
export async function startSession(req: Request, res: Response, user: { id: string; role: string }) {
  const refreshToken = randomBytes(48).toString('base64url');
  const r = await q(`INSERT INTO user_sessions (user_id, refresh_token_hash, user_agent, ip_address, expires_at)
    VALUES ($1, $2, $3, $4, now() + interval '30 days') RETURNING id`,
    [user.id, sha256(refreshToken), String(req.headers['user-agent'] ?? '').slice(0, 500) || null, req.ip ?? null]);
  setAccessCookie(res, user, r.rows[0].id);
  setRefreshCookie(res, refreshToken);
}
export function clearSessionCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, cookieOptions);
  res.clearCookie(REFRESH_COOKIE, cookieOptions);
}
export async function revokeSession(sessionId: string, userId: string, reason = 'user_logout') {
  await q(`UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, now()), revoke_reason = COALESCE(revoke_reason, $3)
    WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [sessionId, userId, reason]);
}
export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  await q(`UPDATE user_sessions SET revoked_at = now(), revoke_reason = 'user_revoke_all'
    WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2)`, [userId, exceptSessionId ?? null]);
}
export async function refreshSession(req: Request, res: Response) {
  const oldToken = req.cookies?.[REFRESH_COOKIE];
  if (typeof oldToken !== 'string' || oldToken.length < 40) throw new HttpError(401, 'Session expirée', 'unauthenticated');
  const newToken = randomBytes(48).toString('base64url');
  const result = await withTx(null, async (c) => {
    const found = await c.query(`SELECT s.id, s.user_id, u.role, u.account_status
      FROM user_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.refresh_token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.deleted_at IS NULL
      FOR UPDATE OF s`, [sha256(oldToken)]);
    const row = found.rows[0];
    if (!row || row.account_status !== 'active') throw new HttpError(401, 'Session expirée ou révoquée', 'unauthenticated');
    await c.query(`UPDATE user_sessions SET refresh_token_hash = $2, last_seen_at = now(),
      user_agent = $3, ip_address = $4 WHERE id = $1`,
      [row.id, sha256(newToken), String(req.headers['user-agent'] ?? '').slice(0, 500) || null, req.ip ?? null]);
    return { id: row.id, user: { id: row.user_id, role: row.role } };
  });
  setAccessCookie(res, result.user, result.id);
  setRefreshCookie(res, newToken);
  return { ok: true };
}
export async function listSessions(userId: string, currentSessionId: string) {
  const r = await q(`SELECT id, user_agent, ip_address, created_at, last_seen_at, expires_at,
      (id = $2::uuid) AS current
    FROM user_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
    ORDER BY last_seen_at DESC`, [userId, currentSessionId]);
  return r.rows;
}
export async function revokeSessionById(sessionId: string, userId: string) {
  const r = await q(`UPDATE user_sessions SET revoked_at = now(), revoke_reason = 'user_revoked'
    WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id`, [sessionId, userId]);
  if (!r.rows[0]) throw new HttpError(404, 'Session introuvable ou déjà révoquée', 'not_found');
}
function readToken(req: Request): string | undefined {
  return req.cookies?.[ACCESS_COOKIE] ?? req.headers.authorization?.match(/^Bearer (.+)$/i)?.[1];
}
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readToken(req);
  if (!token) return next(new HttpError(401, 'Connexion requise', 'unauthenticated'));
  let payload: jwt.JwtPayload;
  try { payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload; }
  catch { return next(new HttpError(401, 'Session expirée', 'unauthenticated')); }
  const userId = String(payload.sub ?? ''), sessionId = String(payload.sid ?? '');
  if (!userId || !sessionId) return next(new HttpError(401, 'Session invalide : reconnectez-vous', 'unauthenticated'));
  q(`SELECT u.role, u.account_status FROM user_sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL
        AND s.expires_at > now() AND u.deleted_at IS NULL`, [sessionId, userId])
    .then((r) => {
      const user = r.rows[0];
      if (!user) return next(new HttpError(401, 'Session invalide ou révoquée', 'unauthenticated'));
      if (user.account_status !== 'active') return next(new HttpError(403, 'Ce compte est suspendu ou désactivé', 'account_unavailable'));
      req.user = { id: userId, role: user.role === 'admin' ? 'admin' : 'creator', sessionId };
      q(`UPDATE user_sessions SET last_seen_at = now() WHERE id = $1 AND last_seen_at < now() - interval '1 minute'`, [sessionId]).catch(() => undefined);
      next();
    }).catch(next);
}
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  requireAuth(req, res, (err?: any) => {
    if (err) return next(err);
    q('SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL', [req.user!.id])
      .then((r) => r.rows[0]?.role === 'admin' ? next() : next(new HttpError(403, 'Réservé aux administrateurs', 'forbidden')))
      .catch(next);
  });
}
export const randomToken = () => randomBytes(24).toString('base64url');
