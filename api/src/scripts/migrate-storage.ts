import { createHash } from 'node:crypto';
import path from 'node:path';
import { config } from '../config.js';
import { pool, q } from '../db.js';
import { LocalStorage, S3Storage } from '../storage.js';

const apply = process.argv.includes('--apply');
const digest = (data: Buffer) => createHash('sha256').update(data).digest('hex');

async function main() {
  const local = new LocalStorage(path.resolve(config.UPLOAD_DIR));
  const result = await q<{ key: string }>('SELECT key FROM uploads ORDER BY created_at, key');
  const keys = result.rows.map((row) => row.key);
  console.log(\`Fichiers référencés en base : \${keys.length}\`);
  if (!apply) {
    console.log('Mode simulation : aucun objet ne sera modifié.');
    console.log('Relancer avec --apply pour copier et vérifier les objets.');
    return;
  }

  if (!config.S3_ENDPOINT || !config.S3_REGION || !config.S3_BUCKET || !config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) {
    throw new Error('Pour --apply, configure les cinq variables S3 obligatoires dans l’environnement.');
  }
  const remote = new S3Storage({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    bucket: config.S3_BUCKET,
    accessKeyId: config.S3_ACCESS_KEY_ID,
    secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    ...(config.S3_SESSION_TOKEN ? { sessionToken: config.S3_SESSION_TOKEN } : {}),
  });

  let copied = 0;
  let alreadyPresent = 0;
  for (const key of keys) {
    const source = await local.get(key);
    const target = await remote.get(key);

    if (target) {
      if (source && digest(source) !== digest(target)) {
        throw new Error(\`Conflit : le fichier local et l'objet S3 diffèrent pour \${key}. Aucun écrasement effectué.\`);
      }
      alreadyPresent++;
      continue;
    }
    if (!source) {
      throw new Error(\`Fichier local absent et objet S3 absent : \${key}. Migration interrompue.\`);
    }

    await remote.put(key, source);
    const verification = await remote.get(key);
    if (!verification || digest(source) !== digest(verification)) {
      throw new Error(\`Échec de vérification SHA-256 après copie : \${key}\`);
    }
    copied++;
    console.log(\`Copié et vérifié : \${key}\`);
  }

  console.log(\`Migration terminée. Copiés : \${copied}. Déjà présents et cohérents : \${alreadyPresent}.\`);
  console.log('Les fichiers locaux et les clés PostgreSQL ont été conservés.');
}

main()
  .catch((error) => {
    console.error('Migration du stockage interrompue :', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
