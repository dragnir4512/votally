#!/usr/bin/env node
// Donne le rôle administrateur à un compte existant :   npm run make-admin -- mon@email.com
// (À lancer avec DATABASE_URL défini. Le rôle est relu en base à chaque requête : l'effet est immédiat.)
import pg from 'pg';

const email = process.argv[2]?.toLowerCase();
if (!email || !process.env.DATABASE_URL) { console.error('Usage : DATABASE_URL=... node scripts/make-admin.mjs email@exemple.com'); process.exit(1); }
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const r = await db.query(`UPDATE users SET role = 'admin' WHERE email = $1 AND deleted_at IS NULL RETURNING email, full_name`, [email]);
await db.end();
if (!r.rows[0]) { console.error(`Aucun compte avec l'email ${email} : crée-le d'abord via /inscription.`); process.exit(2); }
console.log(`✔ ${r.rows[0].email} (${r.rows[0].full_name ?? 'sans nom'}) est maintenant administrateur.`);
