import type { Context } from 'hono';
import type { AppContext } from '../env';
import { isValidCode } from './code';
import { allow, clientHash, isMissBlocked, recordMiss } from './rateLimit';
import { findByCode, type ShareRow } from './store';

export type GoneReason = 'expired' | 'deleted' | 'removed';

export type Lookup =
  | { kind: 'ok'; row: ShareRow }
  | { kind: 'not_found' }
  | { kind: 'gone'; reason: GoneReason }
  | { kind: 'rate_limited' };

/** Shared by the API and the landing page: rate limits + status mapping. */
export async function lookupShare(c: Context<AppContext>, code: string): Promise<Lookup> {
  const hash = await clientHash(c);
  if (!(await allow(c.env.RL_READ, `read:${hash}`)) || (await isMissBlocked(hash))) {
    return { kind: 'rate_limited' };
  }

  const row = isValidCode(code) ? await findByCode(c.env, code) : null;
  if (!row || row.status === 'pending') {
    return (await recordMiss(c, hash)) ? { kind: 'not_found' } : { kind: 'rate_limited' };
  }

  switch (row.status) {
    case 'active':
      return { kind: 'ok', row };
    case 'expired':
      return { kind: 'gone', reason: 'expired' };
    case 'deleted':
      return { kind: 'gone', reason: 'deleted' };
    default:
      return { kind: 'gone', reason: 'removed' };
  }
}
