import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET : 16 caractères minimum'),
  // Poivre des numéros de téléphone : NE JAMAIS le perdre ni le changer (voir HANDOFF.md)
  PHONE_HASH_PEPPER: z.string().min(16, 'PHONE_HASH_PEPPER : 16 caractères minimum'),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  // Frais de transaction estimés (points de base) affichés au votant. 250 = 2,5 %. À remplacer par le barème réel de l'agrégateur.
  FEE_RATE_BPS: z.coerce.number().int().min(0).max(1000).default(250),
  PAYMENT_PROVIDER: z.enum(['mock']).default('mock'),
  MOCK_WEBHOOK_SECRET: z.string().min(8).default('mock-secret-change-me'),
  CORS_ORIGINS: z.string().default('http://localhost:3001'),
  // Dossier des fichiers téléversés (développement / serveur unique). En production : stockage objet S3 (voir storage.ts).
  UPLOAD_DIR: z.string().default('./uploads'),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Configuration invalide :\n' + parsed.error.issues.map((i) => ` - ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}
export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';
