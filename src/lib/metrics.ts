import type { Env } from '../env';
import { addCounters, bumpShareTraffic } from './store';

/**
 * Approximate traffic metrics for the admin dashboard.
 *
 * Counting every request with its own D1 write would burn the free write
 * quota on a busy day, so counts are kept in isolate memory and flushed in
 * one batch at most every FLUSH_MS (via waitUntil). An evicted busy isolate
 * can lose up to a minute of counts — fine for a dashboard, never used for limits.
 */
export type Metric =
  | 'request'
  | 'view'
  | 'fetch'
  | 'status'
  | 'create'
  | 'create_retry'
  | 'report'
  | 'not_found'
  | 'gone'
  | 'rate_limited'
  | 'daily_limit'
  | 'rejected_invalid'
  | 'rejected_title'
  | 'screened'
  | 'error';

/**
 * At most one flush per isolate per minute. Quiet isolates (today's normal
 * traffic) flush on nearly every request; busy ones batch. Worst case stays
 * far below the free D1 limit of 100k rows written per day, so metrics can
 * never starve real share writes.
 */
const FLUSH_MS = 60_000;

const counters = new Map<Metric, number>();
const shareTraffic = new Map<string, { views: number; fetches: number; checks: number }>();
let lastFlush = 0;
let flushing: Promise<void> | null = null;

export function count(metric: Metric, by = 1): void {
  counters.set(metric, (counters.get(metric) ?? 0) + by);
}

export function countShare(code: string, kind: 'views' | 'fetches' | 'checks'): void {
  const entry = shareTraffic.get(code) ?? { views: 0, fetches: 0, checks: 0 };
  entry[kind]++;
  shareTraffic.set(code, entry);
}

/** Call once per request (after counting); flushes when due. */
export function maybeFlush(env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }, force = false): void {
  if (flushing || (!force && Date.now() - lastFlush < FLUSH_MS)) return;
  if (counters.size === 0 && shareTraffic.size === 0) return;
  const metricEntries = [...counters].map(([name, n]) => ({ key: `m:${name}`, count: n }));
  const traffic = [...shareTraffic].map(([code, t]) => ({ code, ...t }));
  counters.clear();
  shareTraffic.clear();
  lastFlush = Date.now();
  flushing = Promise.all([addCounters(env, metricEntries), bumpShareTraffic(env, traffic)])
    .then(() => undefined)
    .catch((err) => console.error('metrics_flush_failed', String(err)))
    .finally(() => {
      flushing = null;
    });
  ctx.waitUntil(flushing);
}

/** Test helper. */
export function resetMetrics(): void {
  counters.clear();
  shareTraffic.clear();
  lastFlush = 0;
}
