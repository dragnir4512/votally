import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      JWT_SECRET: 'test-secret-0123456789abcdef',
      PHONE_HASH_PEPPER: 'test-pepper-0123456789abcdef',
      BCRYPT_COST: '4',
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://votally:votally@localhost:5432/votally_test',
    },
    testTimeout: 20_000,
    hookTimeout: 20_000,
    fileParallelism: false,
  },
});
