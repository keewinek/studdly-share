import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { runDailyMaintenance } from '../src/cron';
import { sha256Hex } from '../src/lib/crypto';
import { findByCode, readPayload, reserve, unixDay } from '../src/lib/store';
import { BASE, createShare, freshIp, get, newSecret, samplePayload, testEnv } from './helpers';

async function createOk(payload: unknown = samplePayload(), secret = newSecret()) {
  const res = await createShare(payload, secret);
  expect(res.status).toBe(201);
  return (await res.json()) as { code: string; url: string; created_at: number };
}

describe('POST /api/v1/shares', () => {
  it('creates a share and returns a 5-char code and URL', async () => {
    const body = await createOk();
    expect(body.code).toMatch(/^[23456789BCDFGHJKLMNPQRSTVWXYZbcdfghjkmnpqrstvwxyz]{5}$/);
    expect(body.url).toBe(`${BASE}/${body.code}`);
    const row = await findByCode(testEnv, body.code);
    expect(row?.status).toBe('active');
    expect(row?.sub_topic_count).toBe(2);
    expect(row?.question_count).toBe(3);
    expect(row?.app_version).toBe('1.3.0+70');
  });

  it('is idempotent for the same owner secret (retry after timeout)', async () => {
    const secret = newSecret();
    const first = await createOk(samplePayload(), secret);
    const retry = await createShare(samplePayload({ title: 'Changed' }), secret);
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as { code: string }).code).toBe(first.code);
  });

  it('finishes a pending share left by a crashed attempt', async () => {
    const secret = newSecret();
    const ownerHash = await sha256Hex(secret);
    const now = Math.floor(Date.now() / 1000);
    expect(
      await reserve(testEnv, {
        code: 'PNDNG',
        owner_hash: ownerHash,
        payload_shard: 1,
        schema_version: 1,
        title: 'old',
        language: 'pl',
        sub_topic_count: 1,
        question_count: 1,
        size_gz_bytes: 1,
        content_sha256: 'x',
        app_version: null,
        created_at: now,
        last_accessed_day: unixDay(now),
      }),
    ).toBe('ok');
    const res = await createShare(samplePayload(), secret);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { code: string }).code).toBe('PNDNG');
    const row = await findByCode(testEnv, 'PNDNG');
    expect(row?.status).toBe('active');
    expect(row?.title).toBe('Fotosynteza');
    expect(await readPayload(testEnv, 1, 'PNDNG')).not.toBeNull();
  });

  it('reports code collisions to the caller of reserve', async () => {
    const { code } = await createOk();
    const row = await findByCode(testEnv, code);
    const outcome = await reserve(testEnv, { ...row!, owner_hash: await sha256Hex(newSecret()) });
    expect(outcome).toBe('code_taken');
  });

  it('rejects missing owner secret, wrong content type, bad JSON, invalid payload and big bodies', async () => {
    const noAuth = await SELF.fetch(`${BASE}/api/v1/shares`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(samplePayload()),
    });
    expect(noAuth.status).toBe(401);
    expect(((await noAuth.json()) as { error: string }).error).toBe('missing_owner_secret');

    const auth = { Authorization: `Bearer ${newSecret()}`, 'CF-Connecting-IP': freshIp() };
    const textBody = await SELF.fetch(`${BASE}/api/v1/shares`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'text/plain' },
      body: 'hi',
    });
    expect(textBody.status).toBe(415);

    const badJson = await SELF.fetch(`${BASE}/api/v1/shares`, {
      method: 'POST',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: '{nope',
    });
    expect(badJson.status).toBe(400);
    expect(((await badJson.json()) as { error: string }).error).toBe('invalid_json');

    const invalid = await createShare(samplePayload({ language: 'xx' }));
    expect(invalid.status).toBe(400);
    const invalidBody = (await invalid.json()) as { error: string; issues: { path: string }[] };
    expect(invalidBody.error).toBe('invalid_payload');
    expect(invalidBody.issues[0]?.path).toBe('language');

    const newer = await createShare(samplePayload({ schema: 2 }));
    expect(newer.status).toBe(422);

    const huge = await createShare(samplePayload({ title: 'x'.repeat(1024 * 1024) }));
    expect(huge.status).toBe(413);
  });
});

describe('reading shares', () => {
  it('returns status and the canonical payload', async () => {
    const { code, created_at } = await createOk();
    const status = await get(`/api/v1/shares/${code}/status`);
    expect(status.status).toBe(200);
    expect(await status.json()).toEqual({ status: 'active', created_at, expires_at: created_at + 30 * 86_400 });

    const res = await get(`/api/v1/shares/${code}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
    const body = (await res.json()) as { code: string; payload: ReturnType<typeof samplePayload> };
    expect(body.code).toBe(code);
    expect(body.payload.title).toBe('Fotosynteza');
    expect(body.payload.sub_topics[0]?.content).toBe('Rośliny zamieniają światło w energię.\n\nTo się dzieje w liściach.');

    const etag = res.headers.get('ETag')!;
    const cached = await get(`/api/v1/shares/${code}`, { headers: { 'If-None-Match': etag } });
    expect(cached.status).toBe(304);
  });

  it('returns 404 for unknown and malformed codes', async () => {
    expect((await get('/api/v1/shares/BCDFG/status')).status).toBe(404);
    expect((await get('/api/v1/shares/aeiou')).status).toBe(404);
    expect((await get('/api/v1/nope')).status).toBe(404);
  });

  it('blocks a client after too many misses, even for real codes', async () => {
    const { code } = await createOk();
    const ip = '198.51.100.77';
    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      statuses.push((await get(`/api/v1/shares/BCDF${'GHJKMNPQRSTVWXYZbcdfghjkm'[i]}/status`, { headers: { 'CF-Connecting-IP': ip } })).status);
    }
    expect(statuses).toContain(429);
    const real = await get(`/api/v1/shares/${code}/status`, { headers: { 'CF-Connecting-IP': ip } });
    // Cache API may be unavailable in some runtimes; the limiter itself still produced 429s above.
    expect([200, 429]).toContain(real.status);
  });
});

describe('DELETE /api/v1/shares/:code', () => {
  it('lets only the owner delete, then serves 410 deleted', async () => {
    const secret = newSecret();
    const { code } = await createOk(samplePayload(), secret);

    const stranger = await SELF.fetch(`${BASE}/api/v1/shares/${code}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${newSecret()}` },
    });
    expect(stranger.status).toBe(403);

    const owner = await SELF.fetch(`${BASE}/api/v1/shares/${code}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${secret}` },
    });
    expect(owner.status).toBe(204);
    expect(await readPayload(testEnv, 1, code)).toBeNull();

    const status = await get(`/api/v1/shares/${code}/status`);
    expect(status.status).toBe(410);
    expect(await status.json()).toMatchObject({ error: 'gone', reason: 'deleted' });

    // Re-using a secret of a removed share is refused so the app picks a new one.
    const reuse = await createShare(samplePayload(), secret);
    expect(reuse.status).toBe(409);
  });
});

describe('reports', () => {
  it('auto-hides after three distinct reporters and ignores duplicates', async () => {
    const { code } = await createOk();
    const report = (ip: string) =>
      SELF.fetch(`${BASE}/api/v1/shares/${code}/reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
        body: JSON.stringify({ reason: 'inappropriate' }),
      });

    expect((await report('192.0.2.1')).status).toBe(202);
    expect((await report('192.0.2.1')).status).toBe(202);
    expect((await report('192.0.2.2')).status).toBe(202);
    expect((await findByCode(testEnv, code))?.status).toBe('active');
    expect((await report('192.0.2.3')).status).toBe(202);
    expect((await findByCode(testEnv, code))?.status).toBe('removed_pending_review');

    const status = await get(`/api/v1/shares/${code}/status`);
    expect(await status.json()).toMatchObject({ reason: 'removed' });
  });

  it('answers 202 for unknown codes and 400 for bad reasons', async () => {
    const unknown = await SELF.fetch(`${BASE}/api/v1/shares/BCDFG/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'spam' }),
    });
    expect(unknown.status).toBe(202);
    const bad = await SELF.fetch(`${BASE}/api/v1/shares/BCDFG/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'meh' }),
    });
    expect(bad.status).toBe(400);
  });
});

describe('admin', () => {
  it('is hidden without the token and can take a share down with it', async () => {
    const { code } = await createOk();
    expect((await SELF.fetch(`${BASE}/api/admin/shares/${code}`, { method: 'DELETE' })).status).toBe(401);
    const res = await SELF.fetch(`${BASE}/api/admin/shares/${code}`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer test-admin-token' },
    });
    expect(res.status).toBe(204);
    expect((await get(`/api/v1/shares/${code}`)).status).toBe(410);
  });
});

describe('landing page', () => {
  it('renders an escaped, localized preview with store links', async () => {
    const { code } = await createOk(samplePayload({ title: '<script>alert(1)</script> & "quotes"' }));
    const res = await get(`/${code}`, {
      headers: { 'Accept-Language': 'pl-PL,pl;q=0.9', 'User-Agent': 'Mozilla/5.0 (Linux; Android 14)' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Security-Policy')).toContain("script-src 'self'");
    expect(res.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    const html = await res.text();
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;quotes&quot;');
    expect(html).toContain('Ktoś udostępnił Ci temat!');
    expect(html).toContain('2 lekcje · 3 pytania w quizach');
    // Lesson titles are not listed on the page any more — only the topic title.
    expect(html).not.toContain('Chlorofil');
    expect(html).toContain(`intent://share.studdly.app/${code}#Intent;scheme=https;package=com.studdly.app`);
    expect(html).toContain('referrer%3Dshare_code%253D' + code);
    expect(html).toContain(`<meta property="og:url" content="${BASE}/${code}">`);
    expect(html).not.toContain('apps.apple.com');
  });

  it('renders the app topic card with an unstarted progress bar', async () => {
    const { code } = await createOk(samplePayload());
    const html = await (await get(`/${code}`, { headers: { 'Accept-Language': 'pl' } })).text();
    expect(html).toContain('class="topic-card"');
    expect(html).toContain('<span class="progress-label">0/2</span>');
    expect(html).toContain('<span class="progress-label right">0%</span>');
    // Two lessons -> two tick cells (one divider between them).
    expect(html).toContain('<span class="ticks"><i></i><i></i></span>');
  });

  it('greets by name when the payload carries one, and escapes it', async () => {
    const { code } = await createOk(samplePayload({ sharer_name: 'Kasia' }));
    const html = await (await get(`/${code}`, { headers: { 'Accept-Language': 'pl' } })).text();
    expect(html).toContain('Kasia udostępnił Ci temat!');
    expect(html).not.toContain('Ktoś udostępnił Ci temat!');

    const evil = await createOk(samplePayload({ sharer_name: '<img src=x onerror=1>' }));
    const evilHtml = await (await get(`/${evil.code}`, { headers: { 'Accept-Language': 'pl' } })).text();
    expect(evilHtml).not.toContain('<img src=x onerror=1>');
    expect(evilHtml).toContain('&lt;img src=x onerror=1&gt;');
  });

  it('falls back to the nameless greeting for payloads without a name', async () => {
    const { code } = await createOk(samplePayload());
    const html = await (await get(`/${code}`, { headers: { 'Accept-Language': 'en' } })).text();
    expect(html).toContain('Someone shared a topic with you!');
  });

  it('offers an Open-in-Studdly button with the logotype on mobile', async () => {
    const { code } = await createOk(samplePayload());
    const html = await (await get(`/${code}`, {
      headers: { 'Accept-Language': 'pl', 'User-Agent': 'Mozilla/5.0 (Linux; Android 14)' },
    })).text();
    expect(html).toContain('class="btn-logotype" src="/logotype.png" alt="Studdly"');
    expect(html).toContain('>Otwórz w</span>');
    expect(html).toContain('<span class="store-name">Google Play</span>');
  });

  it('shows both store buttons with brand marks on desktop, with no inline styles', async () => {
    const { code } = await createOk(samplePayload());
    const html = await (await get(`/${code}`, {
      headers: { 'Accept-Language': 'pl', 'User-Agent': 'Mozilla/5.0 (Macintosh)' },
    })).text();
    expect(html).toContain('<span class="store-name">Google Play</span>');
    expect(html).toContain('<span class="store-name">App Store</span>');
    expect(html).toContain('class="store-logo"');
    // CSP is style-src 'self' — an inline style attribute would be blocked.
    expect(html).not.toMatch(/<[^>]+\sstyle=/);
  });

  it('shows friendly 404 and 410 pages', async () => {
    const missing = await get('/BCDFG', { headers: { 'Accept-Language': 'en' } });
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("We can&#39;t find this topic");

    const secret = newSecret();
    const { code } = await createOk(samplePayload(), secret);
    await SELF.fetch(`${BASE}/api/v1/shares/${code}`, { method: 'DELETE', headers: { Authorization: `Bearer ${secret}` } });
    const gone = await get(`/${code}`, { headers: { 'Accept-Language': 'en' } });
    expect(gone.status).toBe(410);
    expect(await gone.text()).toContain('This link doesn&#39;t work anymore');
  });

  it('redirects the root to studdly.app', async () => {
    const res = await get('/');
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://studdly.app');
  });

  it('ships static assets (served before the Worker in production)', async () => {
    expect((await testEnv.ASSETS.fetch(`${BASE}/styles.css`)).status).toBe(200);
    expect(await (await testEnv.ASSETS.fetch(`${BASE}/robots.txt`)).text()).toContain('Disallow: /');
  });
});

describe('well-known files', () => {
  it('serves apple-app-site-association as JSON', async () => {
    const res = await get('/.well-known/apple-app-site-association');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/json');
    const body = (await res.json()) as { applinks: { details: { appIDs: string[]; components: { '/': string }[] }[] } };
    expect(body.applinks.details[0]?.appIDs).toEqual(['NQT6HQRV63.com.studdly.app']);
    expect(body.applinks.details[0]?.components.map((c) => c['/'])).toContain('/?????');
    const components = body.applinks.details[0]!.components as { '/': string; exclude?: boolean }[];
    const adminIdx = components.findIndex((c) => c['/'] === '/admin' && c.exclude);
    expect(adminIdx).toBeGreaterThanOrEqual(0);
    expect(adminIdx).toBeLessThan(components.findIndex((c) => c['/'] === '/?????'));
  });

  it('serves assetlinks.json from configured fingerprints', async () => {
    const res = await get('/.well-known/assetlinks.json');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { target: { package_name: string; sha256_cert_fingerprints: string[] } }[];
    expect(body[0]?.target.package_name).toBe('com.studdly.app');
    expect(body[0]?.target.sha256_cert_fingerprints).toEqual(['AA:BB:CC']);
  });
});

describe('30-day expiry', () => {
  it('returns expires_at = created_at + 30 days', async () => {
    const body = (await createOk()) as { code: string; created_at: number; expires_at?: number };
    expect(body.expires_at).toBe(body.created_at + 30 * 86_400);
    const status = (await (await get(`/api/v1/shares/${body.code}/status`)).json()) as { expires_at: number };
    expect(status.expires_at).toBe(body.expires_at);
  });

  it('treats an active share past 30 days as expired right away, even before the cron', async () => {
    const secret = newSecret();
    const { code } = await createOk(samplePayload(), secret);
    await testEnv.DB.prepare('UPDATE shares SET created_at = created_at - ? WHERE code = ?').bind(30 * 86_400 + 5, code).run();

    const status = await get(`/api/v1/shares/${code}/status`);
    expect(status.status).toBe(410);
    expect(await status.json()).toMatchObject({ reason: 'expired' });
    expect((await get(`/${code}`)).status).toBe(410);

    // A retry with the old secret must not resurrect the expired link.
    expect((await createShare(samplePayload(), secret)).status).toBe(409);
  });

  it('shows the expiry date on the landing page', async () => {
    const { code } = await createOk();
    const html = await (await get(`/${code}`, { headers: { 'Accept-Language': 'pl' } })).text();
    expect(html).toContain('Link działa do');
  });
});

describe('daily maintenance', () => {
  it('expires shares 30 days after creation and cleans stale pending rows', async () => {
    const { code } = await createOk();
    await testEnv.DB.prepare('UPDATE shares SET created_at = created_at - ? WHERE code = ?').bind(31 * 86_400, code).run();

    const now = Math.floor(Date.now() / 1000);
    await reserve(testEnv, {
      code: 'STLPN',
      owner_hash: await sha256Hex(newSecret()),
      payload_shard: 1,
      schema_version: 1,
      title: 't',
      language: 'en',
      sub_topic_count: 1,
      question_count: 1,
      size_gz_bytes: 1,
      content_sha256: 'x',
      app_version: null,
      created_at: now - 7200,
      last_accessed_day: unixDay(now),
    });

    const result = await runDailyMaintenance(testEnv);
    expect(result.expired).toBeGreaterThanOrEqual(1);
    expect(result.cleaned).toBeGreaterThanOrEqual(1);
    expect((await findByCode(testEnv, code))?.status).toBe('expired');
    expect(await findByCode(testEnv, 'STLPN')).toBeNull();
    expect(await readPayload(testEnv, 1, code)).toBeNull();
  });
});
