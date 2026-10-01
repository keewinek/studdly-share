import { Hono, type Context } from 'hono';
import type { AppContext, Env } from '../env';
import { pickStrings, type Strings } from '../i18n';
import { gunzip } from '../lib/crypto';
import { escapeHtml } from '../lib/html';
import { lookupShare } from '../lib/lookup';
import type { PayloadV1 } from '../lib/payload';
import { expiresAt, readPayload } from '../lib/store';
import { count, countShare } from '../lib/metrics';

const MAX_LISTED_LESSONS = 12;

export const landing = new Hono<AppContext>();

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; script-src 'self'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

type Platform = 'android' | 'ios' | 'desktop';

function platformOf(userAgent: string | undefined): Platform {
  const ua = userAgent ?? '';
  if (/android/i.test(ua)) return 'android';
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  return 'desktop';
}

function playUrl(env: Env, code?: string): string {
  if (!code) return env.PLAY_STORE_URL;
  const sep = env.PLAY_STORE_URL.includes('?') ? '&' : '?';
  return `${env.PLAY_STORE_URL}${sep}referrer=${encodeURIComponent(`share_code=${code}`)}`;
}

function openInAppUrl(env: Env, platform: Platform, code: string): string | null {
  const host = new URL(env.PUBLIC_BASE_URL).host;
  if (platform === 'android') {
    return `intent://${host}/${code}#Intent;scheme=https;package=${env.ANDROID_PACKAGE};S.browser_fallback_url=${encodeURIComponent(playUrl(env, code))};end`;
  }
  if (platform === 'ios') return `studdly://share/${code}`;
  return null;
}

function storeButtons(env: Env, t: Strings, platform: Platform, code?: string): string {
  const play = `<a rel="nofollow" class="btn secondary" href="${escapeHtml(playUrl(env, code))}">${escapeHtml(t.googlePlay)}</a>`;
  const apple = `<a rel="nofollow" class="btn secondary" href="${escapeHtml(env.APP_STORE_URL)}">${escapeHtml(t.appStore)}</a>`;
  if (platform === 'android') return play;
  if (platform === 'ios') return apple;
  return play + apple;
}

interface PageParts {
  t: Strings;
  env: Env;
  title: string;
  description: string;
  canonical: string;
  appArgument?: string;
  body: string;
}

function page({ t, env, title, description, canonical, appArgument, body }: PageParts): string {
  const base = env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const appStoreId = /id(\d+)/.exec(env.APP_STORE_URL)?.[1];
  const smartBanner =
    appStoreId && appArgument
      ? `<meta name="apple-itunes-app" content="app-id=${appStoreId}, app-argument=${escapeHtml(appArgument)}">`
      : '';
  return `<!doctype html>
<html lang="${t.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Studdly">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(canonical)}">
<meta property="og:image" content="${base}/icon.png">
<meta name="twitter:card" content="summary">
<meta name="theme-color" content="#000000">
${smartBanner}
<link rel="icon" href="/icon.png">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header><a rel="nofollow" href="https://studdly.app"><img class="logotype" src="/logotype.png" alt="Studdly" width="140" height="32"></a></header>
<main>
${body}
</main>
<footer><a rel="nofollow" href="${escapeHtml(env.PRIVACY_POLICY_URL)}">${escapeHtml(t.privacy)}</a></footer>
</body>
</html>`;
}

export function messagePage(c: Context<AppContext>, t: Strings, heading: string, text: string, status: 404 | 410 | 429 | 503): Response {
  const platform = platformOf(c.req.header('User-Agent'));
  const html = page({
    t,
    env: c.env,
    title: `${heading} · Studdly`,
    description: text,
    canonical: c.req.url,
    body: `<img class="sloth" src="/sloth.png" alt="" width="160" height="240">
<h1>${escapeHtml(heading)}</h1>
<p class="muted">${escapeHtml(text)}</p>
<div class="actions">${storeButtons(c.env, t, platform)}</div>`,
  });
  return c.body(html, status, { ...PAGE_HEADERS, 'Cache-Control': 'public, max-age=60' });
}

landing.get('/', (c) => c.redirect('https://studdly.app', 302));

landing.get('/:code', async (c) => {
  const t = pickStrings(c.req.header('Accept-Language'));
  const code = c.req.param('code');
  const result = await lookupShare(c, code);
  if (result.kind === 'rate_limited') {
    count('rate_limited');
    return messagePage(c, t, t.busyTitle, t.busyBody, 429);
  }
  if (result.kind === 'not_found') {
    count('not_found');
    return messagePage(c, t, t.notFoundTitle, t.notFoundBody, 404);
  }
  if (result.kind === 'gone') {
    count('gone');
    return messagePage(c, t, t.goneTitle, t.goneBody, 410);
  }

  const { row } = result;
  const gz = await readPayload(c.env, row.payload_shard, row.code);
  if (!gz) return messagePage(c, t, t.notFoundTitle, t.notFoundBody, 404);
  const payload = JSON.parse(await gunzip(gz)) as PayloadV1;
  count('view');
  countShare(row.code, 'views');

  const platform = platformOf(c.req.header('User-Agent'));
  const shareUrl = `${c.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/${row.code}`;
  const summary = `${t.lessons(row.sub_topic_count)} · ${t.questions(row.question_count)}`;
  const listed = payload.sub_topics.slice(0, MAX_LISTED_LESSONS);
  const more = payload.sub_topics.length - listed.length;
  const openUrl = openInAppUrl(c.env, platform, row.code);
  const reasons = Object.entries(t.reasons)
    .map(([key, label]) => `<button type="button" class="reason" data-reason="${key}">${escapeHtml(label)}</button>`)
    .join('');

  const html = page({
    t,
    env: c.env,
    title: `${payload.title} · Studdly`,
    description: `${summary} · ${t.learnInStuddly}`,
    canonical: shareUrl,
    appArgument: shareUrl,
    body: `<p class="kicker">${escapeHtml(t.sharedWithYou)}</p>
<section class="card">
<h1>${escapeHtml(payload.title)}</h1>
<p class="muted">${escapeHtml(summary)}</p>
<ol class="lessons">${listed.map((s) => `<li>${escapeHtml(s.title)}</li>`).join('')}</ol>
${more > 0 ? `<p class="muted more">${escapeHtml(t.andMore(more))}</p>` : ''}
</section>
<div class="actions">
${openUrl ? `<a rel="nofollow" class="btn primary" href="${escapeHtml(openUrl)}">${escapeHtml(t.openInApp)}</a>` : ''}
${storeButtons(c.env, t, platform, row.code)}
</div>
<p class="muted hint">${escapeHtml(t.installHint)}</p>
<p class="muted hint">${escapeHtml(t.validUntil(new Intl.DateTimeFormat(t.lang, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(expiresAt(row) * 1000))))}</p>
<details class="report" data-code="${row.code}">
<summary>${escapeHtml(t.report)}</summary>
<p>${escapeHtml(t.reportQuestion)}</p>
<div class="reasons">${reasons}</div>
<p class="thanks" hidden>${escapeHtml(t.reportThanks)}</p>
</details>
<script src="/report.js" defer></script>`,
  });
  return c.body(html, 200, { ...PAGE_HEADERS, 'Cache-Control': 'public, max-age=300' });
});
