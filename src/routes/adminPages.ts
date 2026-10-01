import { Hono, type Context } from 'hono';
import type { AppContext } from '../env';
import { adminConfigured, isAdmin } from '../lib/adminAuth';
import { gunzip } from '../lib/crypto';
import { escapeHtml as e, formatBytes, formatDay, formatNumber, formatTime } from '../lib/html';
import { LIMITS } from '../lib/limits';
import type { PayloadV1 } from '../lib/payload';
import {
  dashboardData,
  databaseSize,
  expiresAt,
  isExpired,
  findByCode,
  listShares,
  payloadDb,
  readCounter,
  readPayload,
  recentReports,
  type ShareRow,
  writeShard,
} from '../lib/store';

/** Server-rendered admin dashboard at /admin (Polish UI, owner only). */
export const adminPages = new Hono<AppContext>();

const D1_FREE_DB_BYTES = 500 * 1024 * 1024;

const HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; script-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  'X-Robots-Tag': 'noindex, nofollow',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

const STATUS_LABELS: Record<string, string> = {
  active: 'aktywny',
  pending: 'w trakcie zapisu',
  deleted: 'usunięty przez autora',
  expired: 'wygasły',
  removed: 'usunięty (moderacja)',
  removed_pending_review: 'ukryty — czeka na przegląd',
};

const REASON_LABELS: Record<string, string> = {
  inappropriate: 'nieodpowiednie dla dzieci',
  personal_data: 'dane osobowe',
  copyright: 'prawa autorskie',
  spam: 'spam',
  other: 'inne',
};

const METRIC_LABELS: [string, string][] = [
  ['m:view', 'Wyświetlenia stron'],
  ['m:fetch', 'Pobrania do aplikacji'],
  ['m:status', 'Sprawdzenia linku'],
  ['m:create', 'Nowe udostępnienia'],
  ['m:create_retry', 'Ponowienia (ten sam link)'],
  ['m:report', 'Zgłoszenia'],
  ['m:not_found', 'Nieznane kody (404)'],
  ['m:gone', 'Wygasłe/usunięte (410)'],
  ['m:rate_limited', 'Limit na minutę (429)'],
  ['m:daily_limit', 'Limit dzienny'],
  ['m:rejected_invalid', 'Odrzucone dane'],
  ['m:error', 'Błędy serwera'],
];

function layout(title: string, active: string, body: string): string {
  const nav = [
    ['/admin', 'Dashboard', 'dashboard'],
    ['/admin/shares', 'Tematy', 'shares'],
    ['/admin/reports', 'Zgłoszenia', 'reports'],
    ['/admin/settings', 'Ustawienia', 'settings'],
  ]
    .map(([href, label, key]) => `<a rel="nofollow" href="${href}"${key === active ? ' class="active"' : ''}>${label}</a>`)
    .join('');
  return `<!doctype html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${e(title)} · Studdly Admin</title>
<link rel="icon" href="/icon.png">
<link rel="stylesheet" href="/admin.css">
<script src="/admin.js" defer></script>
</head>
<body>
<header class="top"><a rel="nofollow" class="brand" href="/admin"><img src="/logotype.png" alt="Studdly" width="112" height="26"><span>admin</span></a>
${active ? `<nav>${nav}<button type="button" class="link" data-logout>Wyloguj</button></nav>` : ''}</header>
<main>${body}</main>
</body>
</html>`;
}

function page(c: Context<AppContext>, title: string, active: string, body: string, status: 200 | 404 = 200) {
  return c.body(layout(title, active, body), status, HEADERS);
}

function statusBadge(status: string): string {
  return `<span class="badge s-${e(status)}">${e(STATUS_LABELS[status] ?? status)}</span>`;
}

function tile(label: string, value: string, hint = '', tone = ''): string {
  return `<div class="tile${tone ? ` ${tone}` : ''}"><div class="tile-label">${e(label)}</div><div class="tile-value">${value}</div>${
    hint ? `<div class="tile-hint">${hint}</div>` : ''
  }</div>`;
}

function meter(used: number, limit: number): string {
  const pct = Math.min(100, (used / limit) * 100);
  const tone = pct >= 80 ? 'bad' : pct >= 60 ? 'warn' : 'ok';
  return `<svg class="meter ${tone}" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true"><rect width="100" height="6" rx="3" class="track"/><rect width="${pct.toFixed(1)}" height="6" rx="3" class="fill"/></svg>`;
}

/** Inline SVG bar chart (no inline styles/scripts, CSP-safe). */
function barChart(points: { label: string; value: number }[]): string {
  const max = Math.max(1, ...points.map((p) => p.value));
  const w = 100 / points.length;
  const bars = points
    .map((p, i) => {
      const h = (p.value / max) * 90;
      return `<g><title>${e(p.label)}: ${p.value}</title><rect x="${(i * w + w * 0.15).toFixed(2)}" y="${(95 - h).toFixed(2)}" width="${(w * 0.7).toFixed(2)}" height="${Math.max(h, p.value ? 1 : 0).toFixed(2)}" rx="0.6"/></g>`;
    })
    .join('');
  const labels = points
    .filter((_, i) => i % 5 === 0 || i === points.length - 1)
    .map((p) => `<span>${e(p.label)}</span>`)
    .join('');
  return `<svg class="chart" viewBox="0 0 100 100" preserveAspectRatio="none" role="img" aria-label="Wykres">${bars}</svg><div class="chart-labels">${labels}</div>`;
}

function shareRowHtml(s: ShareRow): string {
  return `<tr>
<td><a rel="nofollow" class="mono" href="/admin/shares/${e(s.code)}">${e(s.code)}</a></td>
<td class="title-cell">${e(s.title)}</td>
<td>${statusBadge(s.status)}</td>
<td>${e(s.language)}</td>
<td class="num">${s.sub_topic_count}</td>
<td class="num">${formatBytes(s.size_gz_bytes)}</td>
<td class="num">${formatNumber(s.view_count ?? 0)}</td>
<td class="num">${formatNumber(s.fetch_count ?? 0)}</td>
<td class="num">${s.report_count ? `<span class="warn-text">${s.report_count}</span>` : '0'}</td>
<td>${formatTime(s.created_at)}</td>
</tr>`;
}

const SHARE_TABLE_HEAD =
  '<thead><tr><th>Kod</th><th>Tytuł</th><th>Status</th><th>Język</th><th class="num">Lekcje</th><th class="num">Rozmiar</th><th class="num">Wyświetl.</th><th class="num">Pobrania</th><th class="num">Zgł.</th><th>Utworzony (UTC)</th></tr></thead>';

// ---------------------------------------------------------------------------

adminPages.use('*', async (c, next) => {
  if (!(await adminConfigured(c.env))) {
    return page(c, 'Panel wyłączony', '', '<section class="card narrow"><h1>Panel nie jest skonfigurowany</h1><p class="muted">Brak hasła administratora w bazie (settings → admin_password_hash).</p></section>', 404);
  }
  if (!(await isAdmin(c))) {
    if (c.req.path !== '/admin') return c.redirect('/admin', 302);
    return page(
      c,
      'Logowanie',
      '',
      `<section class="card narrow login">
<h1>Panel administratora</h1>
<form id="login-form" autocomplete="on">
<label for="password">Hasło</label>
<input id="password" name="password" type="password" autocomplete="current-password" required autofocus>
<button type="submit" class="btn primary">Zaloguj</button>
<p class="form-error" id="login-error" hidden></p>
</form>
<p class="muted small">Hasło jest haszowane (SHA-256) w przeglądarce i sprawdzane na serwerze.</p>
</section>`,
    );
  }
  await next();
});

adminPages.get('/', async (c) => {
  const [d, metaSize, shardSize, createsToday] = await Promise.all([
    dashboardData(c.env),
    databaseSize(c.env.DB),
    databaseSize(payloadDb(c.env, writeShard(c.env))),
    readCounter(c.env, 'q:create:all'),
  ]);
  const active = d.statusCounts.find((s) => s.status === 'active')?.n ?? 0;
  const today = Math.floor(Date.now() / 86_400_000);

  const perDay = new Map(d.createdPerDay.map((p) => [p.day, p.n]));
  const chartPoints = Array.from({ length: 30 }, (_, i) => {
    const day = today - 29 + i;
    return { label: formatDay(day), value: perDay.get(day) ?? 0 };
  });

  const days = Array.from({ length: 7 }, (_, i) => today - 6 + i);
  const counterMap = new Map(d.counters.map((x) => [`${x.key}@${x.day}`, x.count]));
  const trafficRows = METRIC_LABELS.map(([key, label]) => {
    const cells = days.map((day) => counterMap.get(`${key}@${day}`) ?? 0);
    const total30 = d.counters.filter((x) => x.key === key).reduce((a, x) => a + x.count, 0);
    const tone = key === 'm:error' && cells.some(Boolean) ? ' class="warn-text"' : '';
    return `<tr><td${tone}>${label}</td>${cells.map((n) => `<td class="num">${formatNumber(n)}</td>`).join('')}<td class="num strong">${formatNumber(total30)}</td></tr>`;
  }).join('');

  const shardPct = (shardSize / D1_FREE_DB_BYTES) * 100;
  const lastCron = d.lastCron ? (JSON.parse(d.lastCron) as { at: number; expired: number; cleaned: number }) : null;

  const body = `
<h1>Dashboard</h1>
<section class="health">
<div><span class="dot ok"></span>API działa · wersja <span class="mono">${e((c.env.GIT_SHA ?? 'dev').slice(0, 7))}</span></div>
<div><span class="dot ${lastCron && Date.now() / 1000 - lastCron.at < 36 * 3600 ? 'ok' : 'warn'}"></span>Codzienne sprzątanie: ${
    lastCron ? `${formatTime(lastCron.at)} (wygasło ${lastCron.expired}, wyczyszczono ${lastCron.cleaned})` : 'jeszcze nie uruchomione'
  }</div>
<div><span class="dot ${d.events24h ? 'warn' : 'ok'}"></span>Błędy (24 h): ${d.events24h}</div>
<div><span class="dot ${shardPct >= 70 ? 'warn' : 'ok'}"></span>Baza tematów: ${shardPct.toFixed(1)}% darmowego limitu</div>
</section>

<section class="tiles">
${tile('Aktywne tematy', formatNumber(active), `łącznie utworzono ${formatNumber(d.created.total)}`)}
${tile('Nowe dziś', formatNumber(d.created.today), `7 dni: ${formatNumber(d.created.week)} · 30 dni: ${formatNumber(d.created.month)}`)}
${tile('Wyświetlenia stron', formatNumber(d.traffic.views), 'łącznie, aktywne tematy')}
${tile('Pobrania do aplikacji', formatNumber(d.traffic.fetches), 'importy i podglądy w aplikacji')}
${tile('Lekcje / pytania', `${formatNumber(d.storage.lessons)} / ${formatNumber(d.storage.questions)}`, 'w przechowywanych tematach')}
${tile('Do moderacji', formatNumber(d.pendingReview), `zgłoszenia 30 dni: ${d.reports30d}`, d.pendingReview ? 'attention' : '')}
</section>

<div class="grid-2">
<section class="card">
<h2>Nowe udostępnienia — 30 dni</h2>
${barChart(chartPoints)}
</section>

<section class="card">
<h2>Miejsce na serwerze</h2>
<dl class="kv">
<dt>Treść tematów (skompresowana)</dt><dd>${formatBytes(d.storage.payloadBytes)}</dd>
<dt>Średni temat / największy</dt><dd>${formatBytes(Math.round(d.storage.avgBytes))} / ${formatBytes(d.storage.maxBytes)}</dd>
<dt>Baza tematów (PAYLOADS_${writeShard(c.env)})</dt><dd>${formatBytes(shardSize)} z 500 MB ${meter(shardSize, D1_FREE_DB_BYTES)}</dd>
<dt>Baza metadanych (DB)</dt><dd>${formatBytes(metaSize)} z 500 MB ${meter(metaSize, D1_FREE_DB_BYTES)}</dd>
<dt>Nowe tematy odrzucane od</dt><dd>${formatBytes(LIMITS.shardFullBytes)}</dd>
</dl>
</section>
</div>

<section class="card">
<h2>Ruch — ostatnie 7 dni <span class="muted small">(wartości przybliżone, dni w UTC)</span></h2>
<div class="table-wrap"><table>
<thead><tr><th></th>${days.map((day) => `<th class="num">${formatDay(day)}</th>`).join('')}<th class="num">30 dni</th></tr></thead>
<tbody>${trafficRows}</tbody>
</table></div>
</section>

<div class="grid-3">
<section class="card">
<h2>Limity dziś</h2>
<dl class="kv">
<dt>Nowe udostępnienia (wszyscy)</dt><dd>${formatNumber(createsToday)} / ${formatNumber(LIMITS.dailyCreatesTotal)} ${meter(createsToday, LIMITS.dailyCreatesTotal)}</dd>
<dt>Na jedno IP dziennie</dt><dd>${LIMITS.dailyCreatesPerClient}</dd>
<dt>Na minutę (IP)</dt><dd>10 utworzeń · 120 odczytów · 20 nieznanych kodów · 5 zgłoszeń</dd>
<dt>Darmowy plan Workers</dt><dd>100 000 żądań / dzień</dd>
</dl>
</section>
<section class="card">
<h2>Statusy</h2>
<table><tbody>${d.statusCounts.map((s) => `<tr><td>${statusBadge(s.status)}</td><td class="num">${formatNumber(s.n)}</td></tr>`).join('') || '<tr><td class="muted">Brak danych</td></tr>'}</tbody></table>
</section>
<section class="card">
<h2>Języki i wersje aplikacji</h2>
<table><tbody>${d.languages.map((l) => `<tr><td>${e(l.language)}</td><td class="num">${formatNumber(l.n)}</td></tr>`).join('')}</tbody></table>
<table class="spaced"><tbody>${d.appVersions.map((v) => `<tr><td class="mono">${e(v.version)}</td><td class="num">${formatNumber(v.n)}</td></tr>`).join('')}</tbody></table>
</section>
</div>

<section class="card">
<h2>Najpopularniejsze tematy</h2>
<div class="table-wrap"><table>${SHARE_TABLE_HEAD}<tbody>${d.topShares.map(shareRowHtml).join('') || '<tr><td colspan="10" class="muted">Brak tematów</td></tr>'}</tbody></table></div>
</section>

<section class="card">
<h2>Ostatnie błędy <span class="muted small">(14 dni)</span></h2>
${
  d.events.length
    ? `<div class="table-wrap"><table><thead><tr><th>Czas (UTC)</th><th>Poziom</th><th>Ścieżka</th><th>Opis</th></tr></thead><tbody>${d.events
        .map((ev) => `<tr><td>${formatTime(ev.created_at)}</td><td>${e(ev.level)}</td><td class="mono">${e(ev.route)}</td><td class="wrap">${e(ev.message)}</td></tr>`)
        .join('')}</tbody></table></div>`
    : '<p class="muted">Brak błędów. 🎉</p>'
}
</section>`;
  return page(c, 'Dashboard', 'dashboard', body);
});

adminPages.get('/shares', async (c) => {
  const status = c.req.query('status') ?? '';
  const query = (c.req.query('q') ?? '').trim().slice(0, 100);
  const sortRaw = c.req.query('sort') ?? 'new';
  const sort = (['new', 'popular', 'size', 'reports'] as const).find((s) => s === sortRaw) ?? 'new';
  const pageNo = Math.max(1, Math.min(10_000, Number.parseInt(c.req.query('page') ?? '1', 10) || 1));
  const { items, total } = await listShares(c.env, {
    status: Object.keys(STATUS_LABELS).includes(status) ? status : undefined,
    query: query || undefined,
    sort,
    page: pageNo,
    pageSize: LIMITS.adminPageSize,
  });
  const pages = Math.max(1, Math.ceil(total / LIMITS.adminPageSize));
  const qs = (p: number) =>
    `/admin/shares?${new URLSearchParams({ status, q: query, sort, page: String(p) }).toString()}`;
  const option = (value: string, label: string, current: string) =>
    `<option value="${e(value)}"${value === current ? ' selected' : ''}>${e(label)}</option>`;

  const body = `
<h1>Tematy <span class="muted small">${formatNumber(total)}</span></h1>
<form class="filters" method="get" action="/admin/shares">
<input type="search" name="q" value="${e(query)}" placeholder="Kod lub tytuł" maxlength="100">
<select name="status">${option('', 'Wszystkie statusy', status)}${Object.entries(STATUS_LABELS).map(([k, v]) => option(k, v, status)).join('')}</select>
<select name="sort">${option('new', 'Najnowsze', sort)}${option('popular', 'Najpopularniejsze', sort)}${option('size', 'Największe', sort)}${option('reports', 'Najwięcej zgłoszeń', sort)}</select>
<button type="submit" class="btn">Filtruj</button>
</form>
<section class="card">
<div class="table-wrap"><table>${SHARE_TABLE_HEAD}<tbody>${items.map(shareRowHtml).join('') || '<tr><td colspan="10" class="muted">Nic nie znaleziono</td></tr>'}</tbody></table></div>
<div class="pager">
${pageNo > 1 ? `<a rel="nofollow" class="btn" href="${e(qs(pageNo - 1))}">← Poprzednia</a>` : '<span></span>'}
<span class="muted">Strona ${pageNo} z ${pages}</span>
${pageNo < pages ? `<a rel="nofollow" class="btn" href="${e(qs(pageNo + 1))}">Następna →</a>` : '<span></span>'}
</div>
</section>`;
  return page(c, 'Tematy', 'shares', body);
});

adminPages.get('/shares/:code', async (c) => {
  const row = await findByCode(c.env, c.req.param('code'));
  if (!row) return page(c, 'Nie znaleziono', 'shares', '<section class="card"><h1>Nie ma takiego tematu</h1><p><a rel="nofollow" href="/admin/shares">← Wróć do listy</a></p></section>', 404);
  const [gz, reports] = await Promise.all([readPayload(c.env, row.payload_shard, row.code), recentReports(c.env, 50, row.code)]);
  let payload: PayloadV1 | null = null;
  if (gz) {
    try {
      payload = JSON.parse(await gunzip(gz)) as PayloadV1;
    } catch {
      payload = null;
    }
  }
  const publicUrl = `${c.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/${row.code}`;
  const actions = [
    row.status === 'active' || row.status === 'removed_pending_review' || row.status === 'pending'
      ? `<button type="button" class="btn danger" data-action="remove" data-code="${e(row.code)}">Usuń temat</button>`
      : '',
    row.status === 'removed_pending_review'
      ? `<button type="button" class="btn primary" data-action="restore" data-code="${e(row.code)}">Przywróć (zgłoszenia niesłuszne)</button>`
      : '',
    gz ? `<a rel="nofollow" class="btn" href="/api/admin/shares/${e(row.code)}/payload">Pobierz JSON</a>` : '',
    row.status === 'active' ? `<a class="btn" href="${e(publicUrl)}" target="_blank" rel="nofollow noopener">Otwórz link publiczny</a>` : '',
  ].join('');

  const lessons = payload
    ? payload.sub_topics
        .map(
          (s, i) => `<details class="lesson"${i === 0 ? ' open' : ''}><summary><span class="muted">${i + 1}.</span> ${e(s.title)} <span class="muted small">(${s.questions.length} pyt.)</span></summary>
<div class="lesson-body"><p class="content">${e(s.content)}</p>
<ol class="questions">${s.questions
            .map(
              (q) =>
                `<li><div>${e(q.question)}</div><ul><li class="right">✓ ${e(q.right_answer)}</li>${q.wrong_answers.map((w) => `<li class="wrong">✗ ${e(w)}</li>`).join('')}</ul></li>`,
            )
            .join('')}</ol></div></details>`,
        )
        .join('')
    : '<p class="muted">Treść tego tematu została już usunięta z serwera.</p>';

  const body = `
<p><a rel="nofollow" href="/admin/shares">← Wszystkie tematy</a></p>
<h1>${e(row.title)} <span class="mono muted">${e(row.code)}</span></h1>
<div class="actions">${actions}</div>
<p class="form-error" id="action-error" hidden></p>
<div class="grid-2">
<section class="card">
<h2>Informacje</h2>
<dl class="kv">
<dt>Status</dt><dd>${statusBadge(row.status)}</dd>
<dt>Język / poziom</dt><dd>${e(row.language)}${payload ? ` / ${e(payload.advancement_level)}` : ''}</dd>
<dt>Lekcje / pytania</dt><dd>${row.sub_topic_count} / ${row.question_count}</dd>
<dt>Rozmiar (gzip)</dt><dd>${formatBytes(row.size_gz_bytes)} · baza PAYLOADS_${row.payload_shard}</dd>
<dt>Utworzony</dt><dd>${formatTime(row.created_at)} UTC</dd>
<dt>Wygasa</dt><dd>${formatTime(expiresAt(row))} UTC${row.status === 'active' && isExpired(row) ? ' <span class="warn-text">(już wygasł — usunie go codzienne sprzątanie)</span>' : ''}</dd>
<dt>Ostatnio otwierany</dt><dd>${formatDay(row.last_accessed_day)}</dd>
<dt>Wyświetlenia / pobrania</dt><dd>${formatNumber(row.view_count ?? 0)} / ${formatNumber(row.fetch_count ?? 0)}</dd>
<dt>Wersja aplikacji</dt><dd class="mono">${e(row.app_version ?? '—')}</dd>
<dt>Zmiana statusu</dt><dd>${formatTime(row.status_changed_at)}</dd>
<dt>SHA-256 treści</dt><dd class="mono small wrap">${e(row.content_sha256)}</dd>
</dl>
</section>
<section class="card">
<h2>Zgłoszenia (${reports.length})</h2>
${
  reports.length
    ? `<table><tbody>${reports.map((r) => `<tr><td>${formatTime(r.created_at)}</td><td>${e(REASON_LABELS[r.reason] ?? r.reason)}</td><td class="wrap">${e(r.details ?? '')}</td></tr>`).join('')}</tbody></table>`
    : '<p class="muted">Brak zgłoszeń.</p>'
}
</section>
</div>
<section class="card">
<h2>Treść</h2>
${lessons}
</section>`;
  return page(c, row.title, 'shares', body);
});

adminPages.get('/reports', async (c) => {
  const reports = await recentReports(c.env, 200);
  const body = `
<h1>Zgłoszenia <span class="muted small">ostatnie ${reports.length}</span></h1>
<section class="card"><div class="table-wrap"><table>
<thead><tr><th>Czas (UTC)</th><th>Kod</th><th>Temat</th><th>Status tematu</th><th>Powód</th><th>Opis</th></tr></thead>
<tbody>${
    reports
      .map(
        (r) => `<tr><td>${formatTime(r.created_at)}</td><td><a rel="nofollow" class="mono" href="/admin/shares/${e(r.code)}">${e(r.code)}</a></td><td class="title-cell">${e(r.title ?? '—')}</td><td>${r.status ? statusBadge(r.status) : '—'}</td><td>${e(REASON_LABELS[r.reason] ?? r.reason)}</td><td class="wrap">${e(r.details ?? '')}</td></tr>`,
      )
      .join('') || '<tr><td colspan="6" class="muted">Brak zgłoszeń</td></tr>'
  }</tbody></table></div></section>`;
  return page(c, 'Zgłoszenia', 'reports', body);
});

adminPages.get('/settings', (c) =>
  page(
    c,
    'Ustawienia',
    'settings',
    `<h1>Ustawienia</h1>
<section class="card narrow">
<h2>Zmień hasło</h2>
<form id="password-form">
<label for="current">Obecne hasło</label>
<input id="current" type="password" autocomplete="current-password" required>
<label for="next">Nowe hasło (min. 12 znaków)</label>
<input id="next" type="password" autocomplete="new-password" minlength="12" required>
<label for="repeat">Powtórz nowe hasło</label>
<input id="repeat" type="password" autocomplete="new-password" minlength="12" required>
<button type="submit" class="btn primary">Zmień hasło</button>
<p class="form-error" id="password-error" hidden></p>
<p class="form-ok" id="password-ok" hidden>Hasło zmienione. Inne sesje zostały wylogowane.</p>
</form>
</section>
<section class="card narrow">
<h2>Limity systemu</h2>
<dl class="kv">
<dt>Udostępnienia / IP / dzień</dt><dd>${LIMITS.dailyCreatesPerClient}</dd>
<dt>Udostępnienia / dzień (wszyscy)</dt><dd>${formatNumber(LIMITS.dailyCreatesTotal)}</dd>
<dt>Błędne logowania / IP / dzień</dt><dd>${LIMITS.dailyAdminLoginFailuresPerClient}</dd>
<dt>Ostrzeżenie o miejscu</dt><dd>${formatBytes(LIMITS.shardWarnBytes)}</dd>
<dt>Blokada nowych tematów</dt><dd>${formatBytes(LIMITS.shardFullBytes)}</dd>
<dt>Ważność linku</dt><dd>${LIMITS.shareTtlDays} dni od utworzenia</dd>
<dt>Sesja administratora</dt><dd>${LIMITS.adminSessionSeconds / 3600} h</dd>
</dl>
<p class="muted small">Limity zmienia się w <span class="mono">src/lib/limits.ts</span> i <span class="mono">wrangler.jsonc</span>.</p>
</section>`,
  ),
);
