import type { Context } from 'hono';
import type { AppContext } from '../env';
import { hmacHex } from './crypto';

const FALLBACK_SALT = 'studdly-share-default-salt';

/** HMAC of the client IP — raw IPs are never stored or logged. */
export async function clientHash(c: Context<AppContext>): Promise<string> {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  const hash = await hmacHex(c.env.IP_HASH_SALT || FALLBACK_SALT, ip);
  return hash.slice(0, 32);
}

/** Missing bindings (local tools) never block. */
export async function allow(binding: RateLimit | undefined, key: string): Promise<boolean> {
  if (!binding) return true;
  try {
    const { success } = await binding.limit({ key });
    return success;
  } catch {
    return true;
  }
}

// Anti-enumeration: after too many unknown-code lookups, *every* code lookup
// from that client is refused for a minute, so hits and misses look the same.
// Cache API is per data center, matching the rate limiter's locality.
const blockKey = (hash: string) => `https://rate-limit.internal/miss-block/${hash}`;

export async function isMissBlocked(hash: string): Promise<boolean> {
  try {
    return (await caches.default.match(blockKey(hash))) !== undefined;
  } catch {
    return false;
  }
}

export async function recordMiss(c: Context<AppContext>, hash: string): Promise<boolean> {
  const ok = await allow(c.env.RL_MISS, `miss:${hash}`);
  if (!ok) {
    try {
      await caches.default.put(
        blockKey(hash),
        new Response('blocked', { headers: { 'Cache-Control': 'max-age=60' } }),
      );
    } catch {
      // Cache API unavailable (e.g. workers.dev) — the rate limiter alone still applies.
    }
  }
  return ok;
}
