import { SELF } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { setPassword } from '../src/lib/adminAuth';
import { CODE_PATTERN, RESERVED_PATHS, isValidCode } from '../src/lib/code';
import { sha256Hex } from '../src/lib/crypto';
import { LIMITS } from '../src/lib/limits';
import { count, countShare, maybeFlush, resetMetrics } from '../src/lib/metrics';
import { findByCode, readCounter, unixDay } from '../src/lib/store';
import { BASE, createShare, freshIp, newSecret, samplePayload, testEnv } from './helpers';

const PASSWORD = 'correct horse battery staple';
let cookie = '';

async function login(password = PASSWORD, ip = freshIp()) {
  return SELF.fetch(`${BASE}/api/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ password_sha256: await sha256Hex(password) }),
  });
}

function adminGet(path: string, withCookie = true) {
  return SELF.fetch(`${BASE}${path}`, { headers: withCookie ? { Cookie: cookie } : {}, redirect: 'manual' });
}

describe('reserved paths', () => {
  it('admin and other reserved paths can never be share codes', () => {
    for (const path of RESERVED_PATHS) {
      expect(isValidCode(path), path).toBe(false);
      expect(CODE_PATTERN.test(path), path).toBe(false);
    }
  });
});

describe('admin panel before configuration', () => {
  it('reports that the panel is not configured', async () => {
    const res = await adminGet('/admin', false);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain('nie jest skonfigurowany');
  });
});

describe('admin panel', () => {
  beforeAll(async () => {
    await setPassword(testEnv, await sha256Hex(PASSWORD));
    const res = await login();
    expect(res.status).toBe(204);
    cookie = (res.headers.get('Set-Cookie') ?? '').split(';')[0]!;
    expect(cookie).toMatch(/^studdly_admin=\d+\.[0-9a-f]{64}$/);
  });

  it('shows the login page without a session and redirects sub-pages', async () => {
    const res = await adminGet('/admin', false);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="login-form"');
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect((await adminGet('/admin/shares', false)).status).toBe(302);
  });

  it('rejects a wrong password and a forged cookie', async () => {
    const wrong = await login('nope');
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toMatchObject({ error: 'invalid_password' });
    const forged = await SELF.fetch(`${BASE}/admin`, { headers: { Cookie: `studdly_admin=9999999999.${'0'.repeat(64)}` } });
    expect(await forged.text()).toContain('id="login-form"');
  });

  it('locks a client out after too many failed logins in a day', async () => {
    const ip = '198.51.100.200';
    let last: Response | undefined;
    for (let i = 0; i < LIMITS.dailyAdminLoginFailuresPerClient + 2; i++) last = await login('bad', ip);
    expect(last!.status).toBe(429);
    // Even the right password is refused while locked out.
    expect((await login(PASSWORD, ip)).status).toBe(429);
  });

  it('renders the dashboard with stats', async () => {
    await createShare(samplePayload());
    const res = await adminGet('/admin');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('Dashboard');
    expect(html).toContain('Aktywne tematy');
    expect(html).toContain('Miejsce na serwerze');
    expect(html).toContain('Ruch — ostatnie 7 dni');
    expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
  });

  it('lists, searches and shows shares with escaped content', async () => {
    const created = (await (await createShare(samplePayload({ title: '<b>Evil</b> topic' }))).json()) as { code: string };
    const list = await (await adminGet(`/admin/shares?q=${encodeURIComponent('Evil')}`)).text();
    expect(list).toContain(created.code);
    expect(list).toContain('&lt;b&gt;Evil&lt;/b&gt; topic');
    expect(list).not.toContain('<b>Evil</b>');

    const detail = await adminGet(`/admin/shares/${created.code}`);
    expect(detail.status).toBe(200);
    const html = await detail.text();
    expect(html).toContain('Chlorofil');
    expect(html).toContain('✓ W liściach');

    const raw = await adminGet(`/api/admin/shares/${created.code}/payload`);
    expect(raw.status).toBe(200);
    expect(((await raw.json()) as { title: string }).title).toBe('<b>Evil</b> topic');

    expect((await adminGet('/admin/shares/BCDFG')).status).toBe(404);
    expect((await adminGet('/admin/reports')).status).toBe(200);
    expect((await adminGet('/admin/settings')).status).toBe(200);
  });

  it('requires same-origin for cookie-authenticated writes', async () => {
    const { code } = (await (await createShare(samplePayload())).json()) as { code: string };
    const crossSite = await SELF.fetch(`${BASE}/api/admin/shares/${code}`, { method: 'DELETE', headers: { Cookie: cookie } });
    expect(crossSite.status).toBe(403);
    const ok = await SELF.fetch(`${BASE}/api/admin/shares/${code}`, {
      method: 'DELETE',
      headers: { Cookie: cookie, Origin: BASE },
    });
    expect(ok.status).toBe(204);
    expect((await findByCode(testEnv, code))?.status).toBe('removed');
  });

  it('changes the password and invalidates old sessions', async () => {
    const change = await SELF.fetch(`${BASE}/api/admin/password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie, Origin: BASE },
      body: JSON.stringify({ current_sha256: await sha256Hex(PASSWORD), new_sha256: await sha256Hex('another long password') }),
    });
    expect(change.status).toBe(204);
    const fresh = (change.headers.get('Set-Cookie') ?? '').split(';')[0]!;
    expect(await (await adminGet('/admin')).text()).toContain('id="login-form"'); // old cookie
    const withFresh = await SELF.fetch(`${BASE}/admin`, { headers: { Cookie: fresh } });
    expect(await withFresh.text()).toContain('Dashboard');
    expect((await login('another long password')).status).toBe(204);
    await setPassword(testEnv, await sha256Hex(PASSWORD));
  });
});

describe('limits', () => {
  it('refuses new shares over the per-client daily limit, but still answers retries', async () => {
    const ip = '203.0.113.250';
    const secret = newSecret();
    const first = await createShare(samplePayload(), secret, ip);
    expect(first.status).toBe(201);

    await testEnv.DB.prepare("UPDATE counters SET count = ? WHERE key LIKE 'q:create:ip:%' AND day = ?")
      .bind(LIMITS.dailyCreatesPerClient, unixDay())
      .run();

    const blocked = await createShare(samplePayload(), newSecret(), ip);
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ error: 'daily_limit_reached' });
    expect(blocked.headers.get('Retry-After')).toBe('3600');

    const retry = await createShare(samplePayload(), secret, ip);
    expect(retry.status).toBe(200);
  });

  it('pauses sharing for everyone over the global daily limit', async () => {
    await testEnv.DB.prepare(
      "INSERT INTO counters (key, day, count) VALUES ('q:create:all', ?, ?) ON CONFLICT (key, day) DO UPDATE SET count = excluded.count",
    )
      .bind(unixDay(), LIMITS.dailyCreatesTotal)
      .run();
    const res = await createShare(samplePayload());
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'capacity_reached' });
    await testEnv.DB.prepare("UPDATE counters SET count = 0 WHERE key = 'q:create:all'").run();
  });
});

describe('metrics', () => {
  it('flushes batched counters and per-share traffic', async () => {
    resetMetrics();
    const { code } = (await (await createShare(samplePayload())).json()) as { code: string };
    const before = (await findByCode(testEnv, code))!;
    resetMetrics();
    count('view', 3);
    countShare(code, 'views');
    countShare(code, 'fetches');
    const waits: Promise<unknown>[] = [];
    maybeFlush(testEnv, { waitUntil: (p) => waits.push(p) }, true);
    await Promise.all(waits);
    expect(await readCounter(testEnv, 'm:view')).toBeGreaterThanOrEqual(3);
    const after = (await findByCode(testEnv, code))!;
    expect(after.view_count).toBe(before.view_count + 1);
    expect(after.fetch_count).toBe(before.fetch_count + 1);
  });
});
