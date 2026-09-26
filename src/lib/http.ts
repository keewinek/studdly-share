import type { Context } from 'hono';
import type { AppContext } from '../env';

export type ErrorCode =
  | 'invalid_json'
  | 'invalid_payload'
  | 'missing_owner_secret'
  | 'owner_secret_reused'
  | 'forbidden'
  | 'not_found'
  | 'gone'
  | 'payload_too_large'
  | 'unsupported_media_type'
  | 'unsupported_schema'
  | 'rate_limited'
  | 'storage_unavailable';

export function apiError(
  c: Context<AppContext>,
  status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 415 | 422 | 429 | 503,
  error: ErrorCode,
  message: string,
  extra: Record<string, unknown> = {},
): Response {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store' };
  if (status === 429) headers['Retry-After'] = '60';
  if (status === 503) headers['Retry-After'] = '5';
  return c.json({ error, message, ...extra }, status, headers);
}

/** Owner secrets are 32 random bytes as base64url (43 chars); allow a little headroom. */
const OWNER_SECRET_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

export function bearerSecret(c: Context<AppContext>): string | null {
  const header = c.req.header('Authorization') ?? '';
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  const secret = match?.[1];
  return secret && OWNER_SECRET_PATTERN.test(secret) ? secret : null;
}
