import pg from 'pg';
import { config } from './config.js';

// Les compteurs et sommes en FCFA tiennent dans un nombre JS : on évite les chaînes pour bigint/numeric.
pg.types.setTypeParser(20, (v) => parseInt(v, 10));
pg.types.setTypeParser(1700, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: config.DB_POOL_MAX,
  connectionTimeoutMillis: config.DB_CONNECTION_TIMEOUT_MS,
  idleTimeoutMillis: config.DB_IDLE_TIMEOUT_MS,
  statement_timeout: config.DB_STATEMENT_TIMEOUT_MS,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  application_name: 'votally-api',
});
export type Db = pg.PoolClient;

export const q = <T extends pg.QueryResultRow = any>(text: string, params?: unknown[]) => pool.query<T>(text, params as any[]);

/** Transaction avec acteur d'audit (lu par les triggers via votally.actor_id). */
export async function withTx<T>(actorId: string | null, fn: (c: Db) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    if (actorId) await c.query("SELECT set_config('votally.actor_id', $1, true)", [actorId]);
    const result = await fn(c);
    await c.query('COMMIT');   // les contrôles différés de la base (votes, ledger) s'exécutent ici
    return result;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* connexion déjà fermée */ }
    throw e;
  } finally {
    c.release();
  }
}
