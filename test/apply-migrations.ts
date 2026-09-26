import { applyD1Migrations, env, type D1Migration } from 'cloudflare:test';

const e = env as unknown as {
  DB: D1Database;
  PAYLOADS_1: D1Database;
  META_MIGRATIONS: D1Migration[];
  PAYLOAD_MIGRATIONS: D1Migration[];
};
await applyD1Migrations(e.DB, e.META_MIGRATIONS);
await applyD1Migrations(e.PAYLOADS_1, e.PAYLOAD_MIGRATIONS);
