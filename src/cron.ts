import type { Env } from './env';
import { postDiscord } from './lib/discord';
import { LIMITS } from './lib/limits';
import { deletePayload, deleteRow, expireShare, listExpirable, listStalePending, nowSeconds, pruneLogs, setSetting, stats } from './lib/store';

const BATCH = 500;

export async function runDailyMaintenance(env: Env): Promise<{ expired: number; cleaned: number }> {
  let expired = 0;
  for (const row of await listExpirable(env, nowSeconds() - LIMITS.shareTtlDays * 86_400, BATCH)) {
    await expireShare(env, row);
    expired++;
  }

  let cleaned = 0;
  for (const row of await listStalePending(env, nowSeconds() - 3600, BATCH)) {
    await deletePayload(env, row.payload_shard, row.code).catch(() => undefined);
    await deleteRow(env, row.code);
    cleaned++;
  }

  await pruneLogs(env);
  await setSetting(env, 'last_cron', JSON.stringify({ at: nowSeconds(), expired, cleaned }));

  const s = await stats(env);
  const shardLines = s.activeBytesByShard.map(({ shard, bytes }) => {
    const mb = (bytes / 1024 / 1024).toFixed(1);
    return `shard ${shard}: ${mb} MB${bytes > LIMITS.shardWarnBytes ? ' ⚠️ add PAYLOADS_' + (shard + 1) + ' soon' : ''}`;
  });
  await postDiscord(
    env.DISCORD_STATS_WEBHOOK,
    `📊 studdly-share: ${s.createdYesterday} new yesterday · ${s.active} active · ${s.pendingReview} awaiting review · ` +
      `${expired} expired · ${cleaned} stale pending cleaned\n${shardLines.join('\n')}`,
  );
  return { expired, cleaned };
}
