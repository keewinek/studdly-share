import type { Context } from 'hono';
import type { AppContext, Env } from '../env';
import { hmacHex, safeEqual, sha256Hex } from './crypto';
import { LIMITS } from './limits';
import { getSetting, nowSeconds, setSetting } from './store';

/**
 * Admin login.
 *
 * The browser sends `password_sha256 = sha256(password)` (never the raw
 * password). The server stores only `sha256(password_sha256)` in the D1
 * `settings` table (key `admin_password_hash`), so neither the repo nor the
 * database holds anything that can be replayed as a login.
 *
 * Sessions are a signed cookie `<expires>.<hmac(session_key, expires)>`.
 * `session_key` is random, lives in `settings`, and is rotated on password
 * change, which logs out every other session.
 */
export const SESSION_COOKIE = 'studdly_admin';
const HEX64 = /^[0-9a-f]{64}$/;

export function isPasswordDigest(value: unknown): value is string {
  return typeof value === 'string' && HEX64.test(value);
}

async function sessionKey(env: Env): Promise<string> {
  const existing = await getSetting(env, 'admin_session_key');
  if (existing) return existing;
  const key = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('');
  await setSetting(env, 'admin_session_key', key);
  return key;
}

export async function adminConfigured(env: Env): Promise<boolean> {
  return (await getSetting(env, 'admin_password_hash')) !== null;
}

export async function verifyPassword(env: Env, passwordSha256: string): Promise<boolean> {
  const stored = await getSetting(env, 'admin_password_hash');
  if (!stored) return false;
  return safeEqual(await sha256Hex(passwordSha256), stored);
}

export async function setPassword(env: Env, passwordSha256: string): Promise<void> {
  await setSetting(env, 'admin_password_hash', await sha256Hex(passwordSha256));
  await setSetting(env, 'admin_session_key', [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join(''));
}

export async function sessionCookie(env: Env): Promise<string> {
  const expires = nowSeconds() + LIMITS.adminSessionSeconds;
  const sig = await hmacHex(await sessionKey(env), `admin:${expires}`);
  return `${SESSION_COOKIE}=${expires}.${sig}; Path=/; Max-Age=${LIMITS.adminSessionSeconds}; HttpOnly; Secure; SameSite=Strict`;
}

export const clearedCookie = `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`;

function readCookie(c: Context<AppContext>): string | null {
  const header = c.req.header('Cookie') ?? '';
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return rest.join('=');
  }
  return null;
}

/** True for a valid session cookie or the optional ADMIN_TOKEN bearer. */
export async function isAdmin(c: Context<AppContext>): Promise<boolean> {
  const bearer = /^Bearer\s+(\S+)$/i.exec(c.req.header('Authorization') ?? '')?.[1];
  if (bearer && c.env.ADMIN_TOKEN) {
    return safeEqual(await sha256Hex(bearer), await sha256Hex(c.env.ADMIN_TOKEN));
  }
  const cookie = readCookie(c);
  const match = cookie ? /^(\d{9,12})\.([0-9a-f]{64})$/.exec(cookie) : null;
  if (!match) return false;
  const expires = Number(match[1]);
  if (expires < nowSeconds()) return false;
  const key = await getSetting(c.env, 'admin_session_key');
  if (!key) return false;
  return safeEqual(await hmacHex(key, `admin:${expires}`), match[2]!);
}

/**
 * Cookie-authenticated writes must come from our own pages (CSRF guard on top
 * of SameSite=Strict). Bearer-token calls (scripts) are exempt.
 */
export function sameOrigin(c: Context<AppContext>): boolean {
  if (c.req.header('Authorization')) return true;
  const origin = c.req.header('Origin');
  if (!origin) return false;
  try {
    return new URL(origin).host === new URL(c.req.url).host;
  } catch {
    return false;
  }
}
