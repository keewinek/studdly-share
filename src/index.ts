import { Hono } from 'hono';
import type { AppContext, Env } from './env';
import { runDailyMaintenance } from './cron';
import { count, maybeFlush } from './lib/metrics';
import { logEvent } from './lib/store';
import { pickStrings } from './i18n';
import { admin } from './routes/admin';
import { adminPages } from './routes/adminPages';
import { api } from './routes/api';
import { landing, messagePage } from './routes/landing';
import { wellKnown } from './routes/wellKnown';

const app = new Hono<AppContext>();

// Traffic metrics for the admin dashboard (batched, see lib/metrics.ts).
app.use('*', async (c, next) => {
  count('request');
  try {
    await next();
  } finally {
    try {
      maybeFlush(c.env, c.executionCtx);
    } catch {
      // No execution context (unit tests) — metrics are best effort.
    }
  }
});

app.route('/api/v1', api);
app.route('/api/admin', admin);
app.route('/.well-known', wellKnown);
// Must stay before the landing `/:code` route. "admin" can never be a share
// code (the code alphabet has no vowels), see lib/code.ts RESERVED_PATHS.
app.route('/admin', adminPages);
app.route('/', landing);

app.notFound((c) =>
  c.req.path.startsWith('/api/')
    ? c.json({ error: 'not_found', message: 'Unknown endpoint' }, 404, { 'Cache-Control': 'no-store' })
    : c.text('Not found', 404),
);

app.onError((err, c) => {
  console.error('unhandled', c.req.method, c.req.path, err.message);
  count('error');
  try {
    c.executionCtx.waitUntil(
      logEvent(c.env, 'error', `${c.req.method} ${c.req.routePath || c.req.path}`, err.message || String(err)).catch(() => undefined),
    );
  } catch {
    // No execution context (unit tests).
  }
  if (c.req.path.startsWith('/api/')) {
    return c.json({ error: 'storage_unavailable', message: 'Unexpected error, please retry' }, 503, {
      'Retry-After': '5',
      'Cache-Control': 'no-store',
    });
  }
  const t = pickStrings(c.req.header('Accept-Language'));
  return messagePage(c, t, t.busyTitle, t.errorBody, 503);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runDailyMaintenance(env));
  },
} satisfies ExportedHandler<Env>;
