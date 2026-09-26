import { Hono, type Context } from 'hono';
import type { AppContext } from '../env';
import { generateCode, isValidCode } from '../lib/code';
import { gunzip, gzip, safeEqual, sha256Hex } from '../lib/crypto';
import { postDiscord } from '../lib/discord';
import { apiError, bearerSecret } from '../lib/http';
import { lookupShare, type Lookup } from '../lib/lookup';
import { MAX_BODY_BYTES, normalizeText, validatePayload } from '../lib/payload';
import { allow, clientHash } from '../lib/rateLimit';
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
  touch,
  unixDay,
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

function created(c: Context<AppContext>, row: Pick<ShareRow, 'code' | 'created_at'>, status: 200 | 201): Response {
  const url = shareUrl(c, row.code);
  return c.json({ code: row.code, url, created_at: row.created_at }, status, {
    'Cache-Control': 'no-store',
    ...(status === 201 ? { Location: url } : {}),
  });
}

function lookupError(c: Context<AppContext>, result: Exclude<Lookup, { kind: 'ok' }>): Response {
  switch (result.kind) {
    case 'rate_limited':
      return apiError(c, 429, 'rate_limited', 'Too many requests');
    case 'not_found':
      return apiError(c, 404, 'not_found', 'No share with this code');
    case 'gone':
      return apiError(c, 410, 'gone', 'This share is no longer available', { reason: result.reason });
  }
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

  if (!(await allow(c.env.RL_CREATE, `create:${await clientHash(c)}`))) {
    return apiError(c, 429, 'rate_limited', 'Too many shares created, try again in a minute');
  }

  if (!(c.req.header('Content-Type') ?? '').toLowerCase().startsWith('application/json')) {
    return apiError(c, 415, 'unsupported_media_type', 'Content-Type must be application/json');
  }
  const declaredLength = Number(c.req.header('Content-Length') ?? 0);
  if (declaredLength > MAX_BODY_BYTES) return apiError(c, 413, 'payload_too_large', 'Body is larger than 1 MiB');
  const raw = await c.req.arrayBuffer();
  if (raw.byteLength > MAX_BODY_BYTES) return apiError(c, 413, 'payload_too_large', 'Body is larger than 1 MiB');

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return apiError(c, 400, 'invalid_json', 'Body is not valid JSON');
  }

  const result = validatePayload(body);
  if (!result.ok) {
    return result.error === 'unsupported_schema'
      ? apiError(c, 422, 'unsupported_schema', 'Payload schema is newer than this server supports')
      : apiError(c, 400, 'invalid_payload', 'Payload does not match schema v1', { issues: result.issues });
  }

  try {
    const ownerHash = await sha256Hex(secret);
    let existing = await findByOwnerHash(c.env, ownerHash);
    if (existing?.status === 'active') return created(c, existing, 200);
    if (existing && existing.status !== 'pending') {
      return apiError(c, 409, 'owner_secret_reused', 'This owner secret belongs to a removed share; use a new one');
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
      if (outcome === 'ok') existing = { ...share, status: 'pending', report_count: 0, status_changed_at: now };
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
    return created(c, existing, 201);
  } catch (err) {
    console.error('create_failed', String(err));
    return apiError(c, 503, 'storage_unavailable', 'Storage is temporarily unavailable, retry with the same owner secret');
  }
});

api.get('/shares/:code/status', async (c) => {
  const result = await lookupShare(c, c.req.param('code'));
  if (result.kind !== 'ok') return lookupError(c, result);
  c.executionCtx.waitUntil(touch(c.env, result.row.code));
  return c.json({ status: 'active', created_at: result.row.created_at }, 200, { 'Cache-Control': 'no-store' });
});

api.get('/shares/:code', async (c) => {
  const result = await lookupShare(c, c.req.param('code'));
  if (result.kind !== 'ok') return lookupError(c, result);
  const { row } = result;

  const etag = `"${row.content_sha256}"`;
  const headers = { 'Cache-Control': 'public, max-age=300', ETag: etag };
  c.executionCtx.waitUntil(touch(c.env, row.code));
  if (c.req.header('If-None-Match') === etag) return c.body(null, 304, headers);

  const gz = await readPayload(c.env, row.payload_shard, row.code);
  if (!gz) {
    console.error('payload_missing', row.code);
    return apiError(c, 404, 'not_found', 'No share with this code');
  }
  const payloadJson = await gunzip(gz);
  const body = `{"code":${JSON.stringify(row.code)},"created_at":${row.created_at},"payload":${payloadJson}}`;
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

  const reporters = await addReport(c.env, code, hash, reason, details);
  if (reporters === null) return accepted;

  let hidden = false;
  if (reporters >= AUTO_HIDE_REPORTERS) hidden = await setStatus(c.env, code, 'removed_pending_review', ['active']);
  c.executionCtx.waitUntil(
    postDiscord(
      c.env.DISCORD_MODERATION_WEBHOOK,
      `🚩 Report **${reason}** for ${shareUrl(c, code)} — “${row.title}” (${reporters} reporter(s))` +
        (hidden ? '\n⛔ Auto-hidden until reviewed.' : '') +
        (details ? `\n> ${details.replace(/\n/g, ' ')}` : ''),
    ),
  );
  return accepted;
});
