import 'server-only';
import { getLongShortFeed, getPerps } from '../longshort/feed';
import { getMultiplyFeed } from '../multiply/kamino';
import type { LongShortFeed } from '../longshort/types';
import type { MultiplyFeed } from '../multiply/types';
import { underlyingOf } from './assets';
import type { LeverageFeed } from './types';

/** How long one response waits for a source on a cold cache (Kamino's first read takes tens of seconds). */
export const WAIT_MS = 9_000;
const message = (e: unknown) => (e instanceof Error ? e.message : 'unknown error');

type Settled<T> = { state: 'ok'; value: T } | { state: 'failed'; error: string } | { state: 'pending' };

/** The source's answer if it comes within `ms`; otherwise «pending» (it keeps running and fills its cache). */
function within<T>(p: Promise<T>, ms: number): Promise<Settled<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<Settled<T>>((r) => (timer = setTimeout(() => r({ state: 'pending' }), ms)));
  const done = p.then<Settled<T>, Settled<T>>(
    (value) => ({ state: 'ok', value }),
    (e) => ({ state: 'failed', error: message(e) }),
  );
  return Promise.race([done, late]).finally(() => clearTimeout(timer));
}

/**
 * Kamino Multiply pairs, PendleLoop Long/Short markets and the Hyperliquid perp for every
 * underlying either lists. Each source is cached by its own module; this only joins them.
 * A source still loading after `waitMs` is left out and marked pending — the caller keeps
 * `pending` alive (Next's `after`) so the next request finds it cached.
 */
export async function getLeverageFeed(now = Date.now(), waitMs = WAIT_MS): Promise<{ feed: LeverageFeed; pending: Promise<unknown>[] }> {
  const kP = getMultiplyFeed(now);
  const pP = getLongShortFeed(now);
  const [k, p] = await Promise.all([within<MultiplyFeed>(kP, waitMs), within<LongShortFeed>(pP, waitMs)]);
  const pending = [k.state === 'pending' ? kP : null, p.state === 'pending' ? pP : null].filter((x): x is Promise<MultiplyFeed> | Promise<LongShortFeed> => x !== null);
  const kamino = k.state === 'ok' ? k.value.rows : [];
  const pendle = p.state === 'ok' ? p.value.rows : [];
  const errorOf = (s: Settled<{ error: string | null }>, rows: number) => (s.state === 'pending' ? 'pending' : s.state === 'failed' ? s.error : rows ? null : s.value.error);
  const coins = [...kamino.map((r) => underlyingOf(r.collateral.symbol)?.perp), ...pendle.map((r) => underlyingOf(r.base.symbol, r.category)?.perp)].filter((c): c is string => !!c);
  const { perps, error: perpError } = await getPerps(coins, now);
  return {
    feed: {
      kamino,
      kaminoError: errorOf(k, kamino.length),
      pendle,
      pendleError: errorOf(p, pendle.length),
      perps: Object.fromEntries(perps),
      perpError: perps.size || !coins.length ? null : perpError,
      fetchedAt: new Date(now).toISOString(),
    },
    pending,
  };
}
