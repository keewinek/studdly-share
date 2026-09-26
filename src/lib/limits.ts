/**
 * Every server-side limit in one place (documented in ai_context/SECURITY.md).
 * Per-minute limits live in wrangler.jsonc rate-limit bindings.
 */
export const LIMITS = {
  /** A share link works for this many days after it was created. */
  shareTtlDays: 30,
  /** Creates per client (IP hash) per UTC day — generous for school NATs. */
  dailyCreatesPerClient: 100,
  /** Creates across everyone per UTC day — protects the free D1/Worker quota. */
  dailyCreatesTotal: 5000,
  /** Failed admin logins per client per UTC day before a 24 h lockout. */
  dailyAdminLoginFailuresPerClient: 20,
  /** Payload shard size that triggers a Discord warning. */
  shardWarnBytes: 350 * 1024 * 1024,
  /** Payload shard size at which new shares are refused (D1 free cap is 500 MB). */
  shardFullBytes: 480 * 1024 * 1024,
  /** Admin session lifetime. */
  adminSessionSeconds: 12 * 60 * 60,
  /** Admin list pagination. */
  adminPageSize: 50,
  /** Error log retention. */
  eventRetentionDays: 14,
  /** Daily counters retention. */
  counterRetentionDays: 120,
} as const;
