/**
 * The only module that touches D1. Metadata lives in env.DB; gzipped payload
 * bodies live in env.PAYLOADS_<shard> so storage can grow past one database.
 */
import type { Env } from '../env';

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
}

export type NewShare = Omit<ShareRow, 'status' | 'report_count' | 'status_changed_at'>;

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

/** At most one write per share per day keeps D1 writes tiny. */
export async function touch(env: Env, code: string): Promise<void> {
  const today = unixDay();
  await env.DB.prepare('UPDATE shares SET last_accessed_day = ? WHERE code = ? AND last_accessed_day < ?')
    .bind(today, code, today)
    .run();
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

export async function listExpirable(env: Env, beforeDay: number, limit: number): Promise<Pick<ShareRow, 'code' | 'payload_shard'>[]> {
  const { results } = await env.DB.prepare(
    "SELECT code, payload_shard FROM shares WHERE status = 'active' AND last_accessed_day < ? LIMIT ?",
  )
    .bind(beforeDay, limit)
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
