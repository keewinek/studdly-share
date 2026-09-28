import { Hono, type Context } from 'hono';
import type { AppContext, Env } from '../env';
import { pickStrings, type Strings } from '../i18n';
import { gunzip } from '../lib/crypto';
import { escapeHtml } from '../lib/html';
import { lookupShare } from '../lib/lookup';
import type { PayloadV1 } from '../lib/payload';
import { expiresAt, readPayload } from '../lib/store';
import { count, countShare } from '../lib/metrics';


/**
 * Inline monochrome store/chevron marks. They use SVG presentation attributes
 * (not inline CSS), so they pass the page's `style-src 'self'` CSP.
 * These are Studdly-styled marks, not Apple's/Google's official badge artwork.
 */
const PLAY_MARK =
  '<svg class="store-logo" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M1.337.924a1.486 1.486 0 0 0-.112.568v21.017c0 .217.045.419.124.6l11.155-11.087zm12.207 10.065 3.258-3.238L3.45.195a1.466 1.466 0 0 0-.946-.179zm0 2.067-11 10.933c.298.036.612-.016.906-.183l13.324-7.54zm8.474.242-3.919 2.218-3.515-3.493 3.543-3.521 3.891 2.202a1.49 1.49 0 0 1 0 2.594z"/></svg>';
const APPLE_MARK =
  '<svg class="store-logo" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg>';
const CHEVRON_MARK =
  '<svg class="chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="M9 4l8 8-8 8"/></svg>';

/** Segment ticks match the app: at most 16, drawn as dividers between cells. */
const MAX_TICK_SEGMENTS = 16;

/**
 * The topic card from the app's home screen: title, progress bar at 0 (the
 * recipient has not started it yet) and a chevron. Geometry and colors mirror
 * `home_page.dart` / `topic_progress_bar.dart` in keewinek/studdly.
 */
function topicCard(title: string, lessonCount: number, t: Strings): string {
  const ticks =
    lessonCount > 1 && lessonCount <= MAX_TICK_SEGMENTS
      ? `<span class="ticks">${'<i></i>'.repeat(lessonCount)}</span>`
      : '';
  return `<section class="topic-card">
<span class="topic-body">
<span class="topic-title">${escapeHtml(title)}</span>
<span class="progress" role="img" aria-label="${escapeHtml(t.lessons(lessonCount))}">${ticks}<span class="progress-label">0/${lessonCount}</span><span class="progress-label right">0%</span></span>
</span>
${CHEVRON_MARK}
</section>`;
}

function storeButton(href: string, mark: string, top: string, name: string, label: string): string {
  return `<a class="btn store" href="${escapeHtml(href)}" aria-label="${escapeHtml(label)}">${mark}<span class="store-copy"><span class="store-top">${escapeHtml(top)}</span><span class="store-name">${escapeHtml(name)}</span></span></a>`;
}


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
  const play = storeButton(playUrl(env, code), PLAY_MARK, t.getItOn, 'Google Play', t.googlePlay);
  const apple = storeButton(env.APP_STORE_URL, APPLE_MARK, t.downloadOnThe, 'App Store', t.appStore);
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
<header><a href="https://studdly.app"><img class="logotype" src="/logotype.png" alt="Studdly" width="140" height="32"></a></header>
<main>
${body}
</main>
<footer><a href="${escapeHtml(env.PRIVACY_POLICY_URL)}">${escapeHtml(t.privacy)}</a> · <a href="${escapeHtml(env.TERMS_URL)}">${escapeHtml(t.terms)}</a> · <a href="mailto:${escapeHtml(env.CONTACT_EMAIL)}">${escapeHtml(t.contact)}</a></footer>
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
  const openUrl = openInAppUrl(c.env, platform, row.code);
  const headline = t.sharedWithYou;
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
    body: `<h1 class="kicker">${escapeHtml(headline)}</h1>
${topicCard(payload.title, row.sub_topic_count, t)}
<p class="muted summary">${escapeHtml(summary)}</p>
<div class="actions">
${
      openUrl
        ? `<a class="btn primary" href="${escapeHtml(openUrl)}" aria-label="${escapeHtml(t.openInApp)}"><img class="btn-mark" src="/icon.png" alt="" width="26" height="26"><span>${escapeHtml(t.openIn)}</span><img class="btn-logotype" src="/logotype.png" alt="Studdly" width="79" height="18"></a>`
        : ''
    }
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
