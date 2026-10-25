import { createApp } from './app.js';
import { config } from './config.js';
import { pool, q } from './db.js';

const app = createApp();
const server = app.listen(config.PORT, () => console.log(`API VOTALLY sur http://localhost:${config.PORT} (${config.NODE_ENV})`));

// Tâche de fond : expire les commandes en attente dépassées (toutes les minutes)
const timer = setInterval(() => { q('SELECT expire_pending_orders()').catch((e) => console.error('[expire]', e.message)); }, 60_000);

const shutdown = () => { clearInterval(timer); server.close(() => pool.end().then(() => process.exit(0))); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
