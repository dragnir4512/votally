
import { config } from 'dotenv';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');

config({ path: resolve(rootDir, '.env') });

if (!process.env.DATABASE_URL) {
  console.error('Erreur : DATABASE_URL absente du fichier .env');
  process.exit(1);
}

const result = spawnSync(
  'psql',
  [
    process.env.DATABASE_URL,
    '-v',
    'ON_ERROR_STOP=1',
    '-f',
    resolve(rootDir, 'db/tests/invariants.sql'),
  ],
  {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      PGCLIENTENCODING: 'UTF8',
    },
  },
);

if (result.error) {
  console.error('Impossible de lancer PostgreSQL :', result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
