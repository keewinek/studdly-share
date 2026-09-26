import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig(async () => {
  const metaMigrations = await readD1Migrations('migrations/meta');
  const payloadMigrations = await readD1Migrations('migrations/payloads');
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            META_MIGRATIONS: metaMigrations,
            PAYLOAD_MIGRATIONS: payloadMigrations,
            ADMIN_TOKEN: 'test-admin-token',
            ANDROID_CERT_SHA256: 'AA:BB:CC',
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/apply-migrations.ts'] },
  };
});
