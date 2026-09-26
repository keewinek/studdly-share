import { Hono } from 'hono';
import type { AppContext } from '../env';
import {
  adminConfigured,
  clearedCookie,
  isAdmin,
  isPasswordDigest,
  sameOrigin,
  sessionCookie,
  setPassword,
  verifyPassword,
} from '../lib/adminAuth';
import { gunzip } from '../lib/crypto';
import { apiError } from '../lib/http';
import { LIMITS } from '../lib/limits';
import { allow, clientHash } from '../lib/rateLimit';
import { deletePayload, findByCode, incrementQuotas, readCounter, readPayload, setStatus } from '../lib/store';

/** Admin JSON API used by the /admin dashboard (cookie) and scripts (ADMIN_TOKEN). */
export const admin = new Hono<AppContext>();

const noStore = { 'Cache-Control': 'no-store' };

admin.post('/login', async (c) => {
  if (!(await adminConfigured(c.env))) return c.json({ error: 'not_configured' }, 404, noStore);
  const hash = await clientHash(c);
  const failKey = `q:admin_fail:${hash}`;
  if (
    !(await allow(c.env.RL_LOGIN, `login:${hash}`)) ||
    (await readCounter(c.env, failKey)) >= LIMITS.dailyAdminLoginFailuresPerClient
  ) {
    return apiError(c, 429, 'rate_limited', 'Too many login attempts, try again later');
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 400, 'invalid_json', 'Body is not valid JSON');
  }
  const digest = (body as { password_sha256?: unknown })?.password_sha256;
  if (!isPasswordDigest(digest)) return apiError(c, 400, 'invalid_payload', 'password_sha256 must be 64 hex chars');

  if (!(await verifyPassword(c.env, digest))) {
    await incrementQuotas(c.env, [failKey]);
    return c.json({ error: 'invalid_password', message: 'Wrong password' }, 401, noStore);
  }
  return c.body(null, 204, { ...noStore, 'Set-Cookie': await sessionCookie(c.env) });
});

admin.post('/logout', (c) => c.body(null, 204, { ...noStore, 'Set-Cookie': clearedCookie }));

// Everything below needs an admin session (or ADMIN_TOKEN) and, for cookie
// sessions, a same-origin request.
admin.use('*', async (c, next) => {
  if (!(await isAdmin(c))) return c.json({ error: 'unauthorized' }, 401, noStore);
  if (c.req.method !== 'GET' && !sameOrigin(c)) return c.json({ error: 'forbidden' }, 403, noStore);
  await next();
});

admin.post('/password', async (c) => {
  let body: { current_sha256?: unknown; new_sha256?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 400, 'invalid_json', 'Body is not valid JSON');
  }
  if (!isPasswordDigest(body.current_sha256) || !isPasswordDigest(body.new_sha256)) {
    return apiError(c, 400, 'invalid_payload', 'Both digests must be 64 hex chars');
  }
  if (!(await verifyPassword(c.env, body.current_sha256))) {
    return c.json({ error: 'invalid_password', message: 'Wrong current password' }, 401, noStore);
  }
  await setPassword(c.env, body.new_sha256);
  // Other sessions are now invalid; keep this one alive with a fresh cookie.
  return c.body(null, 204, { ...noStore, 'Set-Cookie': await sessionCookie(c.env) });
});

admin.delete('/shares/:code', async (c) => {
  const row = await findByCode(c.env, c.req.param('code'));
  if (!row) return c.json({ error: 'not_found' }, 404, noStore);
  await setStatus(c.env, row.code, 'removed');
  await deletePayload(c.env, row.payload_shard, row.code);
  return c.body(null, 204, noStore);
});

admin.post('/shares/:code/restore', async (c) => {
  const restored = await setStatus(c.env, c.req.param('code'), 'active', ['removed_pending_review']);
  return restored ? c.body(null, 204, noStore) : c.json({ error: 'not_restorable' }, 409, noStore);
});

/** Raw payload JSON (any status that still has a payload) for inspection/download. */
admin.get('/shares/:code/payload', async (c) => {
  const row = await findByCode(c.env, c.req.param('code'));
  if (!row) return c.json({ error: 'not_found' }, 404, noStore);
  const gz = await readPayload(c.env, row.payload_shard, row.code);
  if (!gz) return c.json({ error: 'gone' }, 410, noStore);
  return c.body(await gunzip(gz), 200, {
    ...noStore,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="studdly-share-${row.code}.json"`,
  });
});
