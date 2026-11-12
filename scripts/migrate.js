#!/usr/bin/env node
// Exécuteur de migrations minimal : applique db/migrations/*.sql dans l'ordre, une transaction par fichier,
// et refuse de continuer si un fichier déjà appliqué a été modifié (checksum).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { Client } = require('pg');

const DIR = path.join(__dirname, '..', 'db', 'migrations');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function main() {
  const cmd = process.argv[2] || 'up';
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL manquant (voir .env.example)');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`);
    const applied = new Map((await db.query('SELECT version, checksum FROM schema_migrations')).rows.map(r => [r.version, r.checksum]));
    const files = fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort();

    if (cmd === 'status') {
      for (const f of files) console.log(`${applied.has(f) ? '✔ appliquée ' : '… en attente'}  ${f}`);
      return;
    }
    for (const f of files) {
      const sql = fs.readFileSync(path.join(DIR, f), 'utf8');
      const sum = sha(sql);
      if (applied.has(f)) {
        if (applied.get(f) !== sum) throw new Error(`Migration ${f} modifiée après application : créer une nouvelle migration à la place.`);
        continue;
      }
      process.stdout.write(`→ ${f} ... `);
      try {
        await db.query('BEGIN');
        await db.query(sql);
        await db.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [f, sum]);
        await db.query('COMMIT');
        console.log('ok');
      } catch (e) {
        await db.query('ROLLBACK');
        console.log('ÉCHEC');
        throw e;
      }
    }
    console.log('Base à jour.');
  } finally {
    await db.end();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
