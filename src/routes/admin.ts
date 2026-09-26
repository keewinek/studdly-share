import { Hono } from 'hono';
import type { AppContext } from '../env';
import { safeEqual, sha256Hex } from '../lib/crypto';
import { deletePayload, findByCode, setStatus } from '../lib/store';

/** Moderation endpoints. Disabled (404) unless the ADMIN_TOKEN secret is set. */
export const admin = new Hono<AppContext>();

admin.use('*', async (c, next) => {
  const token = c.env.ADMIN_TOKEN;
  const given = /^Bearer\s+(\S+)$/i.exec(c.req.header('Authorization') ?? '')?.[1] ?? '';
  if (!token || !safeEqual(await sha256Hex(given), await sha256Hex(token))) return c.notFound();
  await next();
});

admin.delete('/shares/:code', async (c) => {
  const row = await findByCode(c.env, c.req.param('code'));
  if (!row) return c.json({ error: 'not_found' }, 404);
  await setStatus(c.env, row.code, 'removed');
  await deletePayload(c.env, row.payload_shard, row.code);
  return c.body(null, 204);
});

admin.post('/shares/:code/restore', async (c) => {
  const restored = await setStatus(c.env, c.req.param('code'), 'active', ['removed_pending_review']);
  return restored ? c.body(null, 204) : c.json({ error: 'not_restorable' }, 409);
});
