import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DB_POOL_MAX: z.coerce.number().int().min(1).max(100).default(20),
  DB_CONNECTION_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30000).default(5000),
  DB_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(30000),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120000).default(15000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET : 16 caractères minimum'),
  // Poivre des numéros de téléphone : NE JAMAIS le perdre ni le changer (voir HANDOFF.md)
  PHONE_HASH_PEPPER: z.string().min(16, 'PHONE_HASH_PEPPER : 16 caractères minimum'),
  BCRYPT_COST: z.coerce.number().int().min(4).max(15).default(12),
  // Frais de transaction estimés (points de base) affichés au votant. 250 = 2,5 %. À remplacer par le barème réel de l'agrégateur.
  FEE_RATE_BPS: z.coerce.number().int().min(0).max(1000).default(250),
  PAYMENT_PROVIDER: z.enum(['mock', 'notchpay']).default('mock'),
  MOCK_WEBHOOK_SECRET: z.string().min(8).default('mock-secret-change-me'),
    // --- Notch Pay : paiements entrants ---
  NOTCHPAY_PUBLIC_KEY: z.string().min(1).optional(),
  NOTCHPAY_HASH_KEY: z.string().min(1).optional(),
  NOTCHPAY_CALLBACK_URL: z.string().url().optional(),
  CORS_ORIGINS: z.string().default('http://localhost:3001'),
  RESEND_API_KEY: z.preprocess((v) => v === '' ? undefined : v, z.string().min(1).optional()),
  EMAIL_FROM: z.preprocess((v) => v === '' ? undefined : v, z.string().min(3).optional()),
  // Dossier des fichiers téléversés (développement / serveur unique). En production : stockage objet S3 (voir storage.ts).
  UPLOAD_DIR: z.string().default('./uploads'),
}).superRefine((data, ctx) => {
  if (!!data.RESEND_API_KEY !== !!data.EMAIL_FROM) {
    ctx.addIssue({ code: 'custom', path: ['EMAIL_FROM'], message: 'RESEND_API_KEY et EMAIL_FROM doivent être configurés ensemble' });
  }
  if (data.PAYMENT_PROVIDER === 'notchpay') {
    const requiredKeys = [
      'NOTCHPAY_PUBLIC_KEY',
      'NOTCHPAY_HASH_KEY',
      'NOTCHPAY_CALLBACK_URL',
    ] as const;

    for (const key of requiredKeys) {
      if (!data[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} est obligatoire lorsque PAYMENT_PROVIDER=notchpay`,
        });
      }
    }
  }
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Configuration invalide :\n' + parsed.error.issues.map((i) => ` - ${i.path.join('.')}: ${i.message}`).join('\n'));
  process.exit(1);
}
export const config = parsed.data;
export const isProd = config.NODE_ENV === 'production';
export const isTest = config.NODE_ENV === 'test';

// Garde-fou de production : aucun paiement réel n'est encore intégré.
// Le simulateur mock ne doit JAMAIS pouvoir être utilisé pour encaisser des votes en production.
if (isProd && config.PAYMENT_PROVIDER === 'mock') {
  console.error('Configuration invalide : PAYMENT_PROVIDER=mock est interdit en production. Configure un agrégateur réel avant le déploiement.');
  process.exit(1);
}
if (isProd && config.MOCK_WEBHOOK_SECRET === 'mock-secret-change-me') {
  console.error('Configuration invalide : MOCK_WEBHOOK_SECRET conserve sa valeur de développement.');
  process.exit(1);
}
