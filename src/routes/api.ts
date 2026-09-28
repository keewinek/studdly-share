import { Hono, type Context } from 'hono';
import type { AppContext } from '../env';
import { generateCode, isValidCode } from '../lib/code';
import { gunzip, gzip, safeEqual, sha256Hex } from '../lib/crypto';
import { postDiscord } from '../lib/discord';
import { apiError, bearerSecret } from '../lib/http';
import { lookupShare, type Lookup } from '../lib/lookup';
import { MAX_BODY_BYTES, normalizeText, validatePayload } from '../lib/payload';
import { allow, clientHash } from '../lib/rateLimit';
import { LIMITS } from '../lib/limits';
import { count, countShare } from '../lib/metrics';
import {
  addReport,
  deletePayload,
  findByCode,
  findByOwnerHash,
  nowSeconds,
  readPayload,
  refreshPending,
  reserve,
  setStatus,
  unixDay,
  expiresAt,
  expireShare,
  isExpired,
  incrementQuotas,
  databaseSize,
  payloadDb,
  logEvent,
  writePayload,
  writeShard,
  type NewShare,
  type ShareRow,
} from '../lib/store';

const MAX_CODE_ATTEMPTS = 5;
const AUTO_HIDE_REPORTERS = 3;
const REPORT_REASONS = ['inappropriate', 'personal_data', 'copyright', 'spam', 'other'] as const;

export const api = new Hono<AppContext>();

const shareUrl = (c: Context<AppContext>, code: string) => `${c.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/${code}`;

/// Moderation deep link. Reports carry the code and a link to the dashboard
/// rather than the reported content itself — see the report handler below.
const adminShareUrl = (c: Context<AppContext>, code: string) =>
  `${c.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/admin/shares/${code}`;

function created(c: Context<AppContext>, row: Pick<ShareRow, 'code' | 'created_at'>, status: 200 | 201): Response {
  const url = shareUrl(c, row.code);
  return c.json({ code: row.code, url, created_at: row.created_at, expires_at: expiresAt(row) }, status, {
    'Cache-Control': 'no-store',
    ...(status === 201 ? { Location: url } : {}),
  });
}

function lookupError(c: Context<AppContext>, result: Exclude<Lookup, { kind: 'ok' }>): Response {
  switch (result.kind) {
    case 'rate_limited':
      count('rate_limited');
      return apiError(c, 429, 'rate_limited', 'Too many requests');
    case 'not_found':
      count('not_found');
      return apiError(c, 404, 'not_found', 'No share with this code');
    case 'gone':
      count('gone');
      return apiError(c, 410, 'gone', 'This share is no longer available', { reason: result.reason });
  }
}

/** Reads the body but stops as soon as it exceeds [max] bytes (no huge buffers). */
async function readBodyLimited(request: Request, max: number): Promise<Uint8Array | 'too_large'> {
  if (Number(request.headers.get('Content-Length') ?? 0) > max) return 'too_large';
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => undefined);
      return 'too_large';
    }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Discord alert at most once per hour per kind (per data center). */
async function alertOnce(c: Context<AppContext>, kind: string, text: string): Promise<void> {
  const key = `https://alerts.internal/${kind}`;
  try {
    if (await caches.default.match(key)) return;
    await caches.default.put(key, new Response('1', { headers: { 'Cache-Control': 'max-age=3600' } }));
  } catch {
    // Cache API unavailable — still alert.
  }
  await postDiscord(c.env.DISCORD_STATS_WEBHOOK ?? c.env.DISCORD_MODERATION_WEBHOOK, text);
}

api.get('/health', async (c) => {
  try {
    await c.env.DB.prepare('SELECT 1').first();
    return c.json({ ok: true, version: c.env.GIT_SHA ?? 'dev' }, 200, { 'Cache-Control': 'no-store' });
  } catch {
    return c.json({ ok: false }, 503, { 'Cache-Control': 'no-store' });
  }
});

api.post('/shares', async (c) => {
  const secret = bearerSecret(c);
  if (!secret) return apiError(c, 401, 'missing_owner_secret', 'Authorization: Bearer <owner_secret> is required');

  const client = await clientHash(c);
  if (!(await allow(c.env.RL_CREATE, `create:${client}`))) {
    count('rate_limited');
    return apiError(c, 429, 'rate_limited', 'Too many shares created, try again in a minute');
  }

  if (!(c.req.header('Content-Type') ?? '').toLowerCase().startsWith('application/json')) {
    return apiError(c, 415, 'unsupported_media_type', 'Content-Type must be application/json');
  }
  const raw = await readBodyLimited(c.req.raw, MAX_BODY_BYTES);
  if (raw === 'too_large') {
    count('rejected_invalid');
    return apiError(c, 413, 'payload_too_large', 'Body is larger than 1 MiB');
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    count('rejected_invalid');
    return apiError(c, 400, 'invalid_json', 'Body is not valid JSON');
  }

  const result = validatePayload(body);
  if (!result.ok) {
    if (result.error === 'title_not_allowed') {
      count('rejected_title');
      return apiError(c, 422, 'title_not_allowed', 'Topic title contains language we do not publish');
    }
    count('rejected_invalid');
    return result.error === 'unsupported_schema'
      ? apiError(c, 422, 'unsupported_schema', 'Payload schema is newer than this server supports')
      : apiError(c, 400, 'invalid_payload', 'Payload does not match schema v1', { issues: result.issues });
  }
  if (result.redactions > 0) count('screened');

  try {
    const ownerHash = await sha256Hex(secret);
    let existing = await findByOwnerHash(c.env, ownerHash);
    if (existing?.status === 'active' && isExpired(existing)) {
      await expireShare(c.env, existing);
      existing = { ...existing, status: 'expired' };
    }
    if (existing?.status === 'active') {
      count('create_retry');
      return created(c, existing, 200);
    }
    if (existing && existing.status !== 'pending') {
      return apiError(c, 409, 'owner_secret_reused', 'This owner secret belongs to a removed share; use a new one');
    }

    if (!existing) {
      // Daily quotas count only brand-new shares (retries above are free).
      const [perClient = 0, total = 0] = await incrementQuotas(c.env, [`q:create:ip:${client}`, 'q:create:all']);
      if (perClient > LIMITS.dailyCreatesPerClient) {
        count('daily_limit');
        return apiError(c, 429, 'daily_limit_reached', 'Daily share limit reached for this network, try again tomorrow', {}, 3600);
      }
      if (total > LIMITS.dailyCreatesTotal) {
        count('daily_limit');
        await alertOnce(c, 'capacity', `⚠️ studdly-share: global daily share limit (${LIMITS.dailyCreatesTotal}) reached`);
        return apiError(c, 503, 'capacity_reached', 'Sharing is paused for today, try again tomorrow', {}, 3600);
      }
      const shardBytes = await databaseSize(payloadDb(c.env, writeShard(c.env)));
      if (shardBytes > LIMITS.shardFullBytes) {
        await alertOnce(c, 'storage_full', `🚨 studdly-share: payload shard ${writeShard(c.env)} is full (${Math.round(shardBytes / 1048576)} MB). Add a new shard.`);
        return apiError(c, 503, 'storage_full', 'Storage is full, try again later', {}, 3600);
      }
      if (shardBytes > LIMITS.shardWarnBytes) {
        c.executionCtx.waitUntil(alertOnce(c, 'storage_warn', `⚠️ studdly-share: payload shard ${writeShard(c.env)} at ${Math.round(shardBytes / 1048576)} MB — add PAYLOADS_${writeShard(c.env) + 1} soon.`));
      }
    }

    const canonical = JSON.stringify(result.payload);
    const gz = await gzip(canonical);
    const now = nowSeconds();
    const share: NewShare = {
      code: '',
      owner_hash: ownerHash,
      payload_shard: writeShard(c.env),
      schema_version: result.payload.schema,
      title: result.payload.title,
      language: result.payload.language,
      sub_topic_count: result.subTopicCount,
      question_count: result.questionCount,
      size_gz_bytes: gz.byteLength,
      content_sha256: await sha256Hex(canonical),
      app_version: (c.req.header('X-Studdly-App-Version') ?? '').slice(0, 32) || null,
      created_at: now,
      last_accessed_day: unixDay(now),
    };

    // Reserve a code first so a collision can never overwrite another share's payload.
    for (let attempt = 0; !existing && attempt < MAX_CODE_ATTEMPTS; attempt++) {
      share.code = generateCode();
      const outcome = await reserve(c.env, share);
      if (outcome === 'ok') {
        existing = { ...share, status: 'pending', report_count: 0, status_changed_at: now, view_count: 0, fetch_count: 0 };
      }
      else if (outcome === 'owner_taken') {
        // A concurrent retry with the same secret won the race.
        existing = await findByOwnerHash(c.env, ownerHash);
        if (existing?.status === 'active') return created(c, existing, 200);
        if (!existing || existing.status !== 'pending') {
          return apiError(c, 409, 'owner_secret_reused', 'This owner secret belongs to a removed share; use a new one');
        }
      }
    }
    if (!existing) return apiError(c, 503, 'storage_unavailable', 'Could not allocate a share code');

    if (existing.code !== share.code) await refreshPending(c.env, existing.code, share);
    await writePayload(c.env, share.payload_shard, existing.code, gz);
    await setStatus(c.env, existing.code, 'active', ['pending']);
    count('create');
    return created(c, existing, 201);
  } catch (err) {
    console.error('create_failed', String(err));
    count('error');
    c.executionCtx.waitUntil(logEvent(c.env, 'error', 'POST /api/v1/shares', String(err)).catch(() => undefined));
    return apiError(c, 503, 'storage_unavailable', 'Storage is temporarily unavailable, retry with the same owner secret');
  }
});

api.get('/shares/:code/status', async (c) => {
  const result = await lookupShare(c, c.req.param('code'));
  if (result.kind !== 'ok') return lookupError(c, result);
  count('status');
  countShare(result.row.code, 'checks');
  return c.json(
    { status: 'active', created_at: result.row.created_at, expires_at: expiresAt(result.row) },
    200,
    { 'Cache-Control': 'no-store' },
  );
});

api.get('/shares/:code', async (c) => {
  const result = await lookupShare(c, c.req.param('code'));
  if (result.kind !== 'ok') return lookupError(c, result);
  const { row } = result;

  const etag = `"${row.content_sha256}"`;
  const headers = { 'Cache-Control': 'public, max-age=300', ETag: etag };
  count('fetch');
  countShare(row.code, 'fetches');
  if (c.req.header('If-None-Match') === etag) return c.body(null, 304, headers);

  const gz = await readPayload(c.env, row.payload_shard, row.code);
  if (!gz) {
    console.error('payload_missing', row.code);
    c.executionCtx.waitUntil(logEvent(c.env, 'warn', 'GET /api/v1/shares/:code', `payload missing for ${row.code}`).catch(() => undefined));
    return apiError(c, 404, 'not_found', 'No share with this code');
  }
  const payloadJson = await gunzip(gz);
  const body = `{"code":${JSON.stringify(row.code)},"created_at":${row.created_at},"expires_at":${expiresAt(row)},"payload":${payloadJson}}`;
  return c.body(body, 200, { ...headers, 'Content-Type': 'application/json; charset=utf-8' });
});

api.delete('/shares/:code', async (c) => {
  const secret = bearerSecret(c);
  if (!secret) return apiError(c, 401, 'missing_owner_secret', 'Authorization: Bearer <owner_secret> is required');
  const code = c.req.param('code');
  const row = isValidCode(code) ? await findByCode(c.env, code) : null;
  if (!row) return apiError(c, 404, 'not_found', 'No share with this code');
  if (!safeEqual(await sha256Hex(secret), row.owner_hash)) return apiError(c, 403, 'forbidden', 'Not the owner');

  if (row.status === 'active' || row.status === 'pending' || row.status === 'removed_pending_review') {
    await setStatus(c.env, code, 'deleted');
    await deletePayload(c.env, row.payload_shard, code);
  }
  return c.body(null, 204);
});

api.post('/shares/:code/reports', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 400, 'invalid_json', 'Body is not valid JSON');
  }
  const reason = (body as { reason?: unknown })?.reason;
  const detailsRaw = (body as { details?: unknown })?.details;
  if (typeof reason !== 'string' || !(REPORT_REASONS as readonly string[]).includes(reason)) {
    return apiError(c, 400, 'invalid_payload', `reason must be one of ${REPORT_REASONS.join(', ')}`);
  }
  if (detailsRaw !== undefined && typeof detailsRaw !== 'string') {
    return apiError(c, 400, 'invalid_payload', 'details must be a string');
  }
  const details = detailsRaw ? normalizeText(detailsRaw).slice(0, 500) || null : null;

  const accepted = c.json({ ok: true }, 202, { 'Cache-Control': 'no-store' });
  const hash = await clientHash(c);
  if (!(await allow(c.env.RL_REPORT, `report:${hash}`))) return accepted;

  // Same answer for unknown codes, so reports can't be used to probe for shares.
  const code = c.req.param('code');
  const row = isValidCode(code) ? await findByCode(c.env, code) : null;
  if (!row || (row.status !== 'active' && row.status !== 'removed_pending_review')) return accepted;

  count('report');
  const reporters = await addReport(c.env, code, hash, reason, details);
  if (reporters === null) return accepted;

  let hidden = false;
  if (reporters >= AUTO_HIDE_REPORTERS) hidden = await setStatus(c.env, code, 'removed_pending_review', ['active']);
  c.executionCtx.waitUntil(
    postDiscord(
      c.env.DISCORD_MODERATION_WEBHOOK,
      // Code and reason only. The title is user content and `details` is free
      // text written by the reporter — both can carry personal data, and
      // Discord is a third party we have no processing agreement with. They
      // stay in D1 and are read in /admin, which runs on the same
      // infrastructure as the rest of the data.
      `🚩 Report **${reason}** for \`${code}\` (${reporters} reporter(s))` +
        (hidden ? '\n⛔ Auto-hidden until reviewed.' : '') +
        `\n${adminShareUrl(c, code)}`,
    ),
  );
  return accepted;
});
