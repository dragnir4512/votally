import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { config, isProd, isTest } from './config.js';
import { errorHandler, ah, HttpError } from './http.js';
import { q } from './db.js';
import { randomUUID } from 'node:crypto';
import { mockProvider } from './providers.js';
import { handleProviderEvent } from './routes/webhooks.js';
import { authRouter } from './routes/auth.js';
import { contestsRouter } from './routes/contests.js';
import { publicRouter } from './routes/public.js';
import { webhooksRouter } from './routes/webhooks.js';

const limiter = (limit: number, windowMs = 60_000) =>
  rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, skip: () => isTest,
    message: { error: { code: 'rate_limited', message: 'Trop de requêtes, réessaie dans un instant' } } });

export function createApp() {
  const app = express();
  app.set('trust proxy', 1);                                   // derrière Cloudflare / un reverse proxy : req.ip fiable
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true }));
  app.use(cookieParser());

  app.use('/webhooks', express.raw({ type: '*/*', limit: '200kb' }), webhooksRouter);   // corps brut AVANT express.json
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', ah(async (_req, res) => { await q('SELECT 1'); res.json({ ok: true }); }));

  app.use('/auth', limiter(20), authRouter);
  app.use('/contests', limiter(300), contestsRouter);
  app.use('/public/contests/:slug/otp', limiter(5));
  app.use('/public/contests/:slug/votes', limiter(20));
  app.use('/public/contests/:slug/orders', limiter(20));
  app.use('/public', limiter(300), publicRouter);

  if (!isProd) {          // Simulateur d'agrégateur pour le développement : jamais exposé en production
    app.post('/dev/mock-pay/:ref', (req, res) => {
      mockProvider.setStatus(req.params.ref as string, req.body?.status ?? 'succeeded');
      res.json({ ok: true });
    });
  }
  if (!isProd) {          // Simule le paiement d'une commande (agrégateur factice) : met à jour le statut puis traite l'événement comme un vrai webhook
    app.post('/dev/mock-pay/orders/:reference', ah(async (req, res) => {
      const r = (await q(`SELECT p.provider_reference FROM payments p JOIN vote_orders o ON o.id = p.order_id
                           WHERE o.reference = $1 AND p.provider = 'mock' AND p.provider_reference IS NOT NULL
                           ORDER BY p.initiated_at DESC LIMIT 1`, [req.params.reference])).rows[0];
      if (!r) throw new HttpError(404, 'Paiement introuvable', 'not_found');
      mockProvider.setStatus(r.provider_reference, req.body?.status ?? 'succeeded');
      res.json(await handleProviderEvent(mockProvider, 'dev-' + randomUUID(), r.provider_reference, { dev: true }));
    }));
  }
  app.use((_req, _res, next) => next(new HttpError(404, 'Route introuvable', 'not_found')));
  app.use(errorHandler);
  return app;
}
