/**
 * The only module that touches D1. Metadata lives in env.DB; gzipped payload
 * bodies live in env.PAYLOADS_<shard> so storage can grow past one database.
 */
import type { Env } from '../env';
import { LIMITS } from './limits';

export type ShareStatus = 'pending' | 'active' | 'deleted' | 'expired' | 'removed' | 'removed_pending_review';

export interface ShareRow {
  code: string;
  owner_hash: string;
  status: ShareStatus;
  payload_shard: number;
  schema_version: number;
  title: string;
  language: string;
  sub_topic_count: number;
  question_count: number;
  size_gz_bytes: number;
  content_sha256: string;
  app_version: string | null;
  created_at: number;
  last_accessed_day: number;
  report_count: number;
  status_changed_at: number | null;
  view_count: number;
  fetch_count: number;
}

export type NewShare = Omit<ShareRow, 'status' | 'report_count' | 'status_changed_at' | 'view_count' | 'fetch_count'>;

export const nowSeconds = (): number => Math.floor(Date.now() / 1000);
export const unixDay = (seconds = nowSeconds()): number => Math.floor(seconds / 86_400);

export function payloadDb(env: Env, shard: number): D1Database {
  const db = (env as unknown as Record<string, D1Database | undefined>)[`PAYLOADS_${shard}`];
  if (!db) throw new Error(`payload shard ${shard} is not bound`);
  return db;
}

export function writeShard(env: Env): number {
  const shard = Number.parseInt(env.PAYLOAD_WRITE_SHARD, 10);
  return Number.isInteger(shard) && shard > 0 ? shard : 1;
}

export async function findByCode(env: Env, code: string): Promise<ShareRow | null> {
  return env.DB.prepare('SELECT * FROM shares WHERE code = ?').bind(code).first<ShareRow>();
}

export async function findByOwnerHash(env: Env, ownerHash: string): Promise<ShareRow | null> {
  return env.DB.prepare('SELECT * FROM shares WHERE owner_hash = ?').bind(ownerHash).first<ShareRow>();
}

/** Inserts a `pending` row, reserving the code before any payload is written. */
export async function reserve(env: Env, s: NewShare): Promise<'ok' | 'code_taken' | 'owner_taken'> {
  try {
    await env.DB.prepare(
      `INSERT INTO shares (code, owner_hash, status, payload_shard, schema_version, title, language,
         sub_topic_count, question_count, size_gz_bytes, content_sha256, app_version, created_at,
         last_accessed_day, status_changed_at)
       VALUES (?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        s.code,
        s.owner_hash,
        s.payload_shard,
        s.schema_version,
        s.title,
        s.language,
        s.sub_topic_count,
        s.question_count,
        s.size_gz_bytes,
        s.content_sha256,
        s.app_version,
        s.created_at,
        s.last_accessed_day,
        s.created_at,
      )
      .run();
    return 'ok';
  } catch (err) {
    const message = String(err);
    if (message.includes('shares.owner_hash')) return 'owner_taken';
    if (message.includes('shares.code')) return 'code_taken';
    throw err;
  }
}

/** Refreshes a pending row with the latest attempt's details (retry after a crash). */
export async function refreshPending(env: Env, code: string, s: NewShare): Promise<void> {
  await env.DB.prepare(
    `UPDATE shares SET payload_shard = ?, schema_version = ?, title = ?, language = ?, sub_topic_count = ?,
       question_count = ?, size_gz_bytes = ?, content_sha256 = ?, app_version = ?
     WHERE code = ? AND status = 'pending'`,
  )
    .bind(
      s.payload_shard,
      s.schema_version,
      s.title,
      s.language,
      s.sub_topic_count,
      s.question_count,
      s.size_gz_bytes,
      s.content_sha256,
      s.app_version,
      code,
    )
    .run();
}

export async function writePayload(env: Env, shard: number, code: string, body: Uint8Array): Promise<void> {
  await payloadDb(env, shard)
    .prepare('INSERT OR REPLACE INTO payloads (code, body) VALUES (?, ?)')
    .bind(code, body)
    .run();
}

export async function readPayload(env: Env, shard: number, code: string): Promise<Uint8Array | null> {
  const row = await payloadDb(env, shard)
    .prepare('SELECT body FROM payloads WHERE code = ?')
    .bind(code)
    .first<{ body: ArrayBuffer | number[] }>();
  if (!row) return null;
  return row.body instanceof ArrayBuffer ? new Uint8Array(row.body) : Uint8Array.from(row.body);
}

export async function deletePayload(env: Env, shard: number, code: string): Promise<void> {
  await payloadDb(env, shard).prepare('DELETE FROM payloads WHERE code = ?').bind(code).run();
}

export async function setStatus(env: Env, code: string, status: ShareStatus, onlyIf?: ShareStatus[]): Promise<boolean> {
  const guard = onlyIf?.length ? ` AND status IN (${onlyIf.map(() => '?').join(', ')})` : '';
  const result = await env.DB.prepare(`UPDATE shares SET status = ?, status_changed_at = ? WHERE code = ?${guard}`)
    .bind(status, nowSeconds(), code, ...(onlyIf ?? []))
    .run();
  return (result.meta.changes ?? 0) > 0;
}

/** Flushes batched per-share traffic (see lib/metrics.ts). */
export async function bumpShareTraffic(
  env: Env,
  updates: { code: string; views: number; fetches: number; checks: number }[],
): Promise<void> {
  if (updates.length === 0) return;
  const today = unixDay();
  await env.DB.batch(
    updates.map((u) =>
      env.DB.prepare(
        `UPDATE shares SET view_count = view_count + ?, fetch_count = fetch_count + ?,
           last_accessed_day = MAX(last_accessed_day, ?) WHERE code = ?`,
      ).bind(u.views, u.fetches, today, u.code),
    ),
  );
}

/** Adds to daily counters (`m:*` metrics). */
export async function addCounters(env: Env, entries: { key: string; count: number }[]): Promise<void> {
  if (entries.length === 0) return;
  const day = unixDay();
  await env.DB.batch(
    entries.map((e) =>
      env.DB.prepare(
        `INSERT INTO counters (key, day, count) VALUES (?, ?, ?)
         ON CONFLICT (key, day) DO UPDATE SET count = count + excluded.count`,
      ).bind(e.key, day, e.count),
    ),
  );
}

/** Increments quota counters (`q:*`) for today and returns the new values in order. */
export async function incrementQuotas(env: Env, keys: string[]): Promise<number[]> {
  const day = unixDay();
  const results = await env.DB.batch<{ count: number }>(
    keys.map((key) =>
      env.DB.prepare(
        `INSERT INTO counters (key, day, count) VALUES (?, ?, 1)
         ON CONFLICT (key, day) DO UPDATE SET count = count + 1 RETURNING count`,
      ).bind(key, day),
    ),
  );
  return results.map((r) => Number(r.results[0]?.count ?? 0));
}

export async function readCounter(env: Env, key: string, day = unixDay()): Promise<number> {
  const row = await env.DB.prepare('SELECT count FROM counters WHERE key = ? AND day = ?')
    .bind(key, day)
    .first<{ count: number }>();
  return Number(row?.count ?? 0);
}

export async function logEvent(env: Env, level: 'error' | 'warn', route: string, message: string): Promise<void> {
  await env.DB.prepare('INSERT INTO events (created_at, level, route, message) VALUES (?, ?, ?, ?)')
    .bind(nowSeconds(), level, route.slice(0, 200), message.slice(0, 1000))
    .run();
}

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

export async function setSetting(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  )
    .bind(key, value, nowSeconds())
    .run();
}

/** Database file size in bytes as reported by D1. */
export async function databaseSize(db: D1Database): Promise<number> {
  const result = await db.prepare('SELECT 1').run();
  return Number((result.meta as { size_after?: number }).size_after ?? 0);
}

export async function pruneLogs(env: Env): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM events WHERE created_at < ?').bind(nowSeconds() - LIMITS.eventRetentionDays * 86_400),
    env.DB.prepare('DELETE FROM counters WHERE day < ?').bind(unixDay() - LIMITS.counterRetentionDays),
    env.DB.prepare('DELETE FROM reports WHERE day < ?').bind(unixDay() - 365),
  ]);
}

/** Returns the number of distinct reporters after this report, or null if it was a duplicate. */
export async function addReport(
  env: Env,
  code: string,
  ipHash: string,
  reason: string,
  details: string | null,
): Promise<number | null> {
  const now = nowSeconds();
  const inserted = await env.DB.prepare(
    'INSERT OR IGNORE INTO reports (code, ip_hash, reason, details, day, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(code, ipHash, reason, details, unixDay(now), now)
    .run();
  if ((inserted.meta.changes ?? 0) === 0) return null;
  const [, count] = await env.DB.batch<{ n: number }>([
    env.DB.prepare('UPDATE shares SET report_count = report_count + 1 WHERE code = ?').bind(code),
    env.DB.prepare('SELECT COUNT(DISTINCT ip_hash) AS n FROM reports WHERE code = ?').bind(code),
  ]);
  return count?.results[0]?.n ?? 1;
}

/** When a share stops working (unix seconds). */
export const expiresAt = (row: Pick<ShareRow, 'created_at'>): number => row.created_at + LIMITS.shareTtlDays * 86_400;

export const isExpired = (row: Pick<ShareRow, 'created_at'>, now = nowSeconds()): boolean => expiresAt(row) <= now;

/** Marks one share expired and drops its payload (lazy expiry between cron runs). */
export async function expireShare(env: Env, row: Pick<ShareRow, 'code' | 'payload_shard'>): Promise<void> {
  if (await setStatus(env, row.code, 'expired', ['active', 'removed_pending_review'])) {
    await deletePayload(env, row.payload_shard, row.code);
  }
}

/** Shares created before [createdBefore] that still hold a payload. */
export async function listExpirable(env: Env, createdBefore: number, limit: number): Promise<Pick<ShareRow, 'code' | 'payload_shard'>[]> {
  const { results } = await env.DB.prepare(
    "SELECT code, payload_shard FROM shares WHERE status IN ('active', 'removed_pending_review') AND created_at < ? LIMIT ?",
  )
    .bind(createdBefore, limit)
    .all<Pick<ShareRow, 'code' | 'payload_shard'>>();
  return results;
}

export async function listStalePending(env: Env, before: number, limit: number): Promise<Pick<ShareRow, 'code' | 'payload_shard'>[]> {
  const { results } = await env.DB.prepare(
    "SELECT code, payload_shard FROM shares WHERE status = 'pending' AND created_at < ? LIMIT ?",
  )
    .bind(before, limit)
    .all<Pick<ShareRow, 'code' | 'payload_shard'>>();
  return results;
}

export async function deleteRow(env: Env, code: string): Promise<void> {
  await env.DB.prepare('DELETE FROM shares WHERE code = ?').bind(code).run();
}

export interface Stats {
  createdYesterday: number;
  active: number;
  pendingReview: number;
  activeBytesByShard: { shard: number; bytes: number }[];
}

export async function stats(env: Env): Promise<Stats> {
  const since = (unixDay() - 1) * 86_400;
  const until = unixDay() * 86_400;
  const [created, active, review, bytes] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n FROM shares WHERE created_at >= ? AND created_at < ?').bind(since, until),
    env.DB.prepare("SELECT COUNT(*) AS n FROM shares WHERE status = 'active'"),
    env.DB.prepare("SELECT COUNT(*) AS n FROM shares WHERE status = 'removed_pending_review'"),
    env.DB.prepare(
      "SELECT payload_shard AS shard, SUM(size_gz_bytes) AS bytes FROM shares WHERE status IN ('active', 'removed_pending_review') GROUP BY payload_shard",
    ),
  ]);
  const n = (r: D1Result | undefined) => Number((r?.results[0] as { n?: number } | undefined)?.n ?? 0);
  return {
    createdYesterday: n(created),
    active: n(active),
    pendingReview: n(review),
    activeBytesByShard: (bytes?.results ?? []) as { shard: number; bytes: number }[],
  };
}

// ---------------------------------------------------------------------------
// Admin dashboard queries (read-only)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
const rows = (r: D1Result | undefined) => (r?.results ?? []) as Row[];
const num = (v: unknown) => Number(v ?? 0);

export interface DashboardData {
  statusCounts: { status: string; n: number }[];
  createdPerDay: { day: number; n: number }[];
  created: { today: number; week: number; month: number; total: number };
  storage: { payloadBytes: number; avgBytes: number; maxBytes: number; lessons: number; questions: number };
  traffic: { views: number; fetches: number };
  languages: { language: string; n: number }[];
  appVersions: { version: string; n: number }[];
  topShares: ShareRow[];
  reports30d: number;
  pendingReview: number;
  counters: { key: string; day: number; count: number }[];
  events: { id: number; created_at: number; level: string; route: string; message: string }[];
  events24h: number;
  lastCron: string | null;
}

export async function dashboardData(env: Env): Promise<DashboardData> {
  const today = unixDay();
  const now = nowSeconds();
  const kept = "status IN ('active', 'removed_pending_review')";
  const q = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args);
  const r = await env.DB.batch([
    q('SELECT status, COUNT(*) AS n FROM shares GROUP BY status ORDER BY n DESC'),
    q('SELECT created_at / 86400 AS day, COUNT(*) AS n FROM shares WHERE created_at >= ? GROUP BY day ORDER BY day', (today - 29) * 86_400),
    q(
      `SELECT SUM(created_at >= ?) AS today, SUM(created_at >= ?) AS week, SUM(created_at >= ?) AS month, COUNT(*) AS total
       FROM shares WHERE status != 'pending'`,
      today * 86_400,
      (today - 6) * 86_400,
      (today - 29) * 86_400,
    ),
    q(
      `SELECT COALESCE(SUM(size_gz_bytes), 0) AS bytes, COALESCE(AVG(size_gz_bytes), 0) AS avg, COALESCE(MAX(size_gz_bytes), 0) AS max,
         COALESCE(SUM(sub_topic_count), 0) AS lessons, COALESCE(SUM(question_count), 0) AS questions,
         COALESCE(SUM(view_count), 0) AS views, COALESCE(SUM(fetch_count), 0) AS fetches
       FROM shares WHERE ${kept}`,
    ),
    q(`SELECT language, COUNT(*) AS n FROM shares WHERE ${kept} GROUP BY language ORDER BY n DESC`),
    q(`SELECT COALESCE(app_version, '?') AS version, COUNT(*) AS n FROM shares WHERE created_at >= ? GROUP BY version ORDER BY n DESC LIMIT 8`, (today - 29) * 86_400),
    q(`SELECT * FROM shares WHERE ${kept} ORDER BY fetch_count DESC, view_count DESC LIMIT 10`),
    q('SELECT COUNT(*) AS n FROM reports WHERE created_at >= ?', now - 30 * 86_400),
    q("SELECT COUNT(*) AS n FROM shares WHERE status = 'removed_pending_review'"),
    q("SELECT key, day, count FROM counters WHERE day >= ? AND key LIKE 'm:%' ORDER BY day", today - 29),
    q('SELECT * FROM events ORDER BY created_at DESC LIMIT 20'),
    q('SELECT COUNT(*) AS n FROM events WHERE created_at >= ?', now - 86_400),
    q("SELECT value FROM settings WHERE key = 'last_cron'"),
  ]);
  const created = rows(r[2])[0] ?? {};
  const storage = rows(r[3])[0] ?? {};
  return {
    statusCounts: rows(r[0]).map((x) => ({ status: String(x.status), n: num(x.n) })),
    createdPerDay: rows(r[1]).map((x) => ({ day: num(x.day), n: num(x.n) })),
    created: { today: num(created.today), week: num(created.week), month: num(created.month), total: num(created.total) },
    storage: {
      payloadBytes: num(storage.bytes),
      avgBytes: num(storage.avg),
      maxBytes: num(storage.max),
      lessons: num(storage.lessons),
      questions: num(storage.questions),
    },
    traffic: { views: num(storage.views), fetches: num(storage.fetches) },
    languages: rows(r[4]).map((x) => ({ language: String(x.language), n: num(x.n) })),
    appVersions: rows(r[5]).map((x) => ({ version: String(x.version), n: num(x.n) })),
    topShares: rows(r[6]) as unknown as ShareRow[],
    reports30d: num(rows(r[7])[0]?.n),
    pendingReview: num(rows(r[8])[0]?.n),
    counters: rows(r[9]).map((x) => ({ key: String(x.key), day: num(x.day), count: num(x.count) })),
    events: rows(r[10]) as unknown as DashboardData['events'],
    events24h: num(rows(r[11])[0]?.n),
    lastCron: (rows(r[12])[0]?.value as string | undefined) ?? null,
  };
}

export interface ShareListFilter {
  status?: string;
  query?: string;
  sort?: 'new' | 'popular' | 'size' | 'reports';
  page: number;
  pageSize: number;
}

export async function listShares(env: Env, f: ShareListFilter): Promise<{ items: ShareRow[]; total: number }> {
  const where: string[] = [];
  const args: unknown[] = [];
  if (f.status) {
    where.push('status = ?');
    args.push(f.status);
  }
  if (f.query) {
    where.push('(code = ? OR title LIKE ?)');
    args.push(f.query, `%${f.query.replace(/[%_]/g, '')}%`);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const order = {
    new: 'created_at DESC',
    popular: 'fetch_count DESC, view_count DESC',
    size: 'size_gz_bytes DESC',
    reports: 'report_count DESC, created_at DESC',
  }[f.sort ?? 'new'];
  const [items, total] = await env.DB.batch([
    env.DB.prepare(`SELECT * FROM shares ${clause} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(
      ...args,
      f.pageSize,
      (f.page - 1) * f.pageSize,
    ),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM shares ${clause}`).bind(...args),
  ]);
  return { items: rows(items) as unknown as ShareRow[], total: num(rows(total)[0]?.n) };
}

export interface ReportRow {
  id: number;
  code: string;
  reason: string;
  details: string | null;
  created_at: number;
  title: string | null;
  status: string | null;
}

export async function recentReports(env: Env, limit: number, code?: string): Promise<ReportRow[]> {
  const sql = `SELECT r.id, r.code, r.reason, r.details, r.created_at, s.title, s.status
     FROM reports r LEFT JOIN shares s ON s.code = r.code
     ${code ? 'WHERE r.code = ?' : ''} ORDER BY r.created_at DESC LIMIT ?`;
  const stmt = code ? env.DB.prepare(sql).bind(code, limit) : env.DB.prepare(sql).bind(limit);
  return (await stmt.all<ReportRow>()).results;
}
