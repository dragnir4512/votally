import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { isProd } from './config.js';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'error') { super(message); }
}

export const ah = (fn: (req: Request, res: Response, next: NextFunction) => unknown): RequestHandler =>
  (req, res, next) => { Promise.resolve(fn(req, res, next)).catch(next); };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function uuidParam(req: Request, name: string): string {
  const v = req.params[name];
  if (!v || !UUID.test(v)) throw new HttpError(404, 'Ressource introuvable', 'not_found');
  return v;
}

export function toCamel<T = any>(row: Record<string, any> | undefined | null): T {
  if (!row) return row as any;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) out[k.replace(/_([a-z])/g, (_, c) => c.toUpperCase())] = v;
  return out as T;
}

/** Traduit les erreurs PostgreSQL (règles métier portées par la base) en réponses HTTP lisibles. */
export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  if (err instanceof ZodError) {
    return res.status(400).json({ error: { code: 'validation', message: 'Données invalides',
      details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) } });
  }
  const code: string | undefined = err?.code;
  if (code === '23505') return res.status(409).json({ error: { code: 'conflict', message: 'Cette valeur existe déjà', constraint: err.constraint } });
  if (code === '23503') return res.status(409).json({ error: { code: 'reference', message: 'Référence invalide ou encore utilisée' } });
  if (code === '23514' || code === '23000') {
    // Avec err.constraint : un CHECK de table ; sans : une règle métier levée par un trigger (message déjà en français)
    return res.status(422).json({ error: { code: err.constraint ? 'constraint' : 'business_rule',
      message: err.constraint ? 'Valeurs non conformes aux règles du concours' : err.message, constraint: err.constraint } });
  }
  if (code === 'P0001') return res.status(400).json({ error: { code: 'rejected', message: err.message } });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: { code: 'bad_json', message: 'JSON invalide' } });
  console.error('[erreur]', req.method, req.originalUrl, err);
  return res.status(500).json({ error: { code: 'internal', message: isProd ? 'Erreur interne' : String(err?.message ?? err) } });
}
