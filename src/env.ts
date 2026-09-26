export interface Env {
  DB: D1Database;
  PAYLOADS_1: D1Database;
  ASSETS: Fetcher;

  RL_CREATE?: RateLimit;
  RL_READ?: RateLimit;
  RL_REPORT?: RateLimit;
  RL_MISS?: RateLimit;

  PUBLIC_BASE_URL: string;
  PAYLOAD_WRITE_SHARD: string;
  APPLE_APP_ID: string;
  ANDROID_PACKAGE: string;
  ANDROID_CERT_SHA256: string;
  PLAY_STORE_URL: string;
  APP_STORE_URL: string;
  PRIVACY_POLICY_URL: string;

  // Secrets (all optional; features that need them turn off when missing).
  IP_HASH_SALT?: string;
  ADMIN_TOKEN?: string;
  DISCORD_MODERATION_WEBHOOK?: string;
  DISCORD_STATS_WEBHOOK?: string;
  GIT_SHA?: string;
}

export type AppContext = { Bindings: Env };
