import type { Env } from './env';
import { postDiscord } from './lib/discord';
import { deletePayload, deleteRow, listExpirable, listStalePending, nowSeconds, setStatus, stats, unixDay } from './lib/store';

const EXPIRE_AFTER_DAYS = 365;
const BATCH = 500;
/** D1 free limit is 500 MB per database; warn well before a shard fills. */
const SHARD_WARN_BYTES = 350 * 1024 * 1024;

export async function runDailyMaintenance(env: Env): Promise<{ expired: number; cleaned: number }> {
  let expired = 0;
  for (const row of await listExpirable(env, unixDay() - EXPIRE_AFTER_DAYS, BATCH)) {
    await setStatus(env, row.code, 'expired', ['active']);
    await deletePayload(env, row.payload_shard, row.code);
    expired++;
  }

  let cleaned = 0;
  for (const row of await listStalePending(env, nowSeconds() - 3600, BATCH)) {
    await deletePayload(env, row.payload_shard, row.code).catch(() => undefined);
    await deleteRow(env, row.code);
    cleaned++;
  }

  const s = await stats(env);
  const shardLines = s.activeBytesByShard.map(({ shard, bytes }) => {
    const mb = (bytes / 1024 / 1024).toFixed(1);
    return `shard ${shard}: ${mb} MB${bytes > SHARD_WARN_BYTES ? ' ⚠️ add PAYLOADS_' + (shard + 1) + ' soon' : ''}`;
  });
  await postDiscord(
    env.DISCORD_STATS_WEBHOOK,
    `📊 studdly-share: ${s.createdYesterday} new yesterday · ${s.active} active · ${s.pendingReview} awaiting review · ` +
      `${expired} expired · ${cleaned} stale pending cleaned\n${shardLines.join('\n')}`,
  );
  return { expired, cleaned };
}
