import { createApp } from './app.js';
import { config } from './config.js';
import { pool, q } from './db.js';
import { settlePayouts } from './payouts.js';

const app = createApp();
const server = app.listen(config.PORT, () => console.log(`API VOTALLY sur http://localhost:${config.PORT} (${config.NODE_ENV})`));

// Tâche de fond : expire les commandes en attente dépassées (toutes les minutes)
const timer = setInterval(() => { q('SELECT expire_pending_orders()').catch((e) => console.error('[expire]', e.message)); }, 60_000);

const payoutTimer = setInterval(() => { settlePayouts().catch((e) => console.error('[retraits]', e.message)); }, 60_000);

// Nettoyage périodique des clés de limitation de débit expirées.
const rateLimitCleanupTimer = setInterval(() => {
  Promise.all([
    q("DELETE FROM api_rate_limits WHERE reset_at < now() - interval '1 day'"),
    q("DELETE FROM otp_codes WHERE expires_at < now() - interval '7 days'"),
  ]).catch((e) => console.error('[security-cleanup]', e.message));
}, 60 * 60_000);

const shutdown = () => { clearInterval(timer); clearInterval(payoutTimer); clearInterval(rateLimitCleanupTimer); server.close(() => pool.end().then(() => process.exit(0))); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
