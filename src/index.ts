import { Hono } from 'hono';
import type { AppContext, Env } from './env';
import { runDailyMaintenance } from './cron';
import { admin } from './routes/admin';
import { api } from './routes/api';
import { landing } from './routes/landing';
import { wellKnown } from './routes/wellKnown';

const app = new Hono<AppContext>();

app.route('/api/v1', api);
app.route('/api/admin', admin);
app.route('/.well-known', wellKnown);
app.route('/', landing);

app.notFound((c) =>
  c.req.path.startsWith('/api/')
    ? c.json({ error: 'not_found', message: 'Unknown endpoint' }, 404)
    : c.text('Not found', 404),
);

app.onError((err, c) => {
  console.error('unhandled', err.message);
  return c.req.path.startsWith('/api/')
    ? c.json({ error: 'storage_unavailable', message: 'Unexpected error, please retry' }, 503, { 'Retry-After': '5' })
    : c.text('Something went wrong', 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runDailyMaintenance(env));
  },
} satisfies ExportedHandler<Env>;
