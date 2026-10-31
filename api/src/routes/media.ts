import { randomBytes } from 'node:crypto';
import express, { Router, type Request } from 'express';
import { ah, HttpError } from '../http.js';
import { q } from '../db.js';
import { isValidKey, storage } from '../storage.js';

export const mediaRouter = Router();
export const MAX_UPLOAD = '8mb';
/** Corps brut : le fichier est envoyé tel quel (Content-Type = type du fichier). */
export const rawFile = express.raw({ type: ['image/*', 'application/pdf'], limit: MAX_UPLOAD });

export function bodyBuffer(req: Request): Buffer {
  const b = req.body;
  if (!Buffer.isBuffer(b) || b.length === 0) throw new HttpError(415, 'Envoie le fichier en corps de requête (Content-Type image/* ou application/pdf)', 'no_file');
  return b;
}

/** Limite quotidienne d'envois par utilisateur et par usage. */
export async function checkQuota(userId: string, purposes: string[], max: number) {
  const r = await q(`SELECT count(*)::int AS n FROM uploads WHERE owner_user_id = $1 AND purpose = ANY($2) AND created_at > now() - interval '1 day'`, [userId, purposes]);
  if (r.rows[0].n >= max) throw new HttpError(429, 'Limite quotidienne d\'envois atteinte', 'upload_quota');
}

export async function storeFile(opts: { userId: string; data: Buffer; ext: string; contentType: string; purpose: string; visibility: 'public' | 'private' }): Promise<string> {
  const key = `${randomBytes(16).toString('hex')}.${opts.ext}`;
  await storage.put(key, opts.data);
  await q('INSERT INTO uploads (key, owner_user_id, visibility, purpose, content_type, size_bytes) VALUES ($1,$2,$3,$4,$5,$6)',
    [key, opts.userId, opts.visibility, opts.purpose, opts.contentType, opts.data.length]);
  return key;
}

/** Images publiques uniquement. Les pièces KYC ne passent JAMAIS par cette route. */
mediaRouter.get('/:key', ah(async (req, res) => {
  const key = req.params.key as string;
  if (!isValidKey(key)) throw new HttpError(404, 'Fichier introuvable', 'not_found');
  const meta = (await q(`SELECT content_type FROM uploads WHERE key = $1 AND visibility = 'public'`, [key])).rows[0];
  const data = meta ? await storage.get(key) : null;
  if (!meta || !data) throw new HttpError(404, 'Fichier introuvable', 'not_found');
  res.set({ 'Content-Type': meta.content_type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff',
            'Cross-Origin-Resource-Policy': 'cross-origin' }).send(data);
}));
