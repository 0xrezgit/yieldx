/**
 * Realized base yield, measured on-chain: the growth of a Pendle SY's `exchangeRate()`
 * (underlying per SY share) between now and 7 and 30 days ago. It is the yield the
 * market actually delivered, independent of the figure Pendle publishes — live data
 * showed the two can disagree badly (superWETH: 0% for 40 days, one 0.36% catch-up,
 * published as 25%).
 *
 * Reading past state needs an archive node. Free public endpoints that serve it are
 * used by default; `ARCHIVE_RPC_URLS` (JSON, chain id → URL) puts a keyed node first.
 * Calls are few (three per market), cached six hours and refreshed in the background.
 * An exchange rate that does not move (rewards or rebasing markets) is not measurable.
 */

const DEFAULT_RPCS: Record<number, string[]> = {
  1: ['https://gateway.tenderly.co/public/mainnet', 'https://rpc.mevblocker.io', 'https://eth.drpc.org'],
  10: ['https://optimism.drpc.org'],
  56: ['https://bsc.drpc.org'],
  130: ['https://unichain.drpc.org'],
  146: ['https://sonic.drpc.org'],
  196: ['https://xlayer.drpc.org'],
  999: ['https://hyperliquid.drpc.org'],
  4663: ['https://robinhood.drpc.org'],
  8453: ['https://base.drpc.org'],
  42161: ['https://arbitrum.drpc.org'],
  80094: ['https://berachain.drpc.org'],
};

function rpcsFor(chainId: number): string[] {
  let extra: string[] = [];
  try {
    const own = JSON.parse(process.env.ARCHIVE_RPC_URLS ?? '{}') as Record<string, string>;
    if (typeof own[String(chainId)] === 'string') extra = [own[String(chainId)]];
  } catch {
    /* a malformed setting is ignored */
  }
  return [...extra, ...(DEFAULT_RPCS[chainId] ?? [])];
}

async function rpc(chainId: number, method: string, params: unknown[]): Promise<string | null> {
  for (const url of rpcsFor(chainId)) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), cache: 'no-store', signal: AbortSignal.timeout(12_000) });
      const body = (await res.json()) as { result?: unknown };
      if (typeof body.result === 'string' && body.result !== '0x') return body.result;
      if (body.result && typeof body.result === 'object' && 'timestamp' in (body.result as object)) return (body.result as { timestamp: string }).timestamp;
    } catch {
      /* next endpoint */
    }
  }
  return null;
}

export interface Realized {
  /** Realized APY over the last 7 and 30 days, %; null when not measurable. */
  d7: number | null;
  d30: number | null;
  at: number;
}

const DAY = 86_400;
const TTL_MS = 6 * 3_600_000;
const cache = new Map<string, Realized>();
const loading = new Set<string>();
/** One measurement at a time per chain, a little apart: free endpoints rate-limit bursts. */
const queues = new Map<number, Promise<unknown>>();
const queued = <T>(chainId: number, job: () => Promise<T>): Promise<T> => {
  const run = (queues.get(chainId) ?? Promise.resolve()).then(() => new Promise((r) => setTimeout(r, 400))).then(job);
  queues.set(chainId, run.catch(() => {}));
  return run;
};
const clock = new Map<number, { head: number; ts: number; secPerBlock: number; at: number }>();

/** Latest block and the chain's average block time (from 100k blocks back), cached an hour. */
async function chainClock(chainId: number) {
  const hit = clock.get(chainId);
  if (hit && Date.now() - hit.at < 3_600_000) return hit;
  const headHex = await rpc(chainId, 'eth_blockNumber', []);
  if (!headHex) return null;
  const head = parseInt(headHex, 16);
  const back = Math.max(1, head - 100_000);
  const [tsNow, tsBack] = await Promise.all([rpc(chainId, 'eth_getBlockByNumber', ['0x' + head.toString(16), false]), rpc(chainId, 'eth_getBlockByNumber', ['0x' + back.toString(16), false])]);
  if (!tsNow || !tsBack) return null;
  const ts = parseInt(tsNow, 16);
  const secPerBlock = (ts - parseInt(tsBack, 16)) / (head - back);
  if (!(secPerBlock > 0)) return null;
  const c = { head, ts, secPerBlock, at: Date.now() };
  clock.set(chainId, c);
  return c;
}

const rateAt = async (chainId: number, sy: string, block: number | 'latest') => {
  const r = await rpc(chainId, 'eth_call', [{ to: sy, data: '0x3ba0b9a9' }, block === 'latest' ? 'latest' : '0x' + block.toString(16)]);
  return r ? Number(BigInt(r)) / 1e18 : null;
};

async function measure(chainId: number, sy: string): Promise<Realized | null> {
  const c = await chainClock(chainId);
  if (!c) return null;
  const blockAgo = (days: number) => Math.max(1, Math.round(c.head - (days * DAY) / c.secPerBlock));
  const [now, w, m] = await Promise.all([rateAt(chainId, sy, c.head), rateAt(chainId, sy, blockAgo(7)), rateAt(chainId, sy, blockAgo(30))]);
  if (now === null) return null;
  // A failed read is unknown; a flat stretch is 0%.
  const apy = (past: number | null, days: number) => (past === null || !(past > 0) ? null : past === now ? 0 : (Math.pow(now / past, 365 / days) - 1) * 100);
  // A rate that never moved measures nothing (the yield is paid another way).
  const moved = (w !== null && w !== now) || (m !== null && m !== now);
  return { d7: moved ? apy(w, 7) : null, d30: moved ? apy(m, 30) : null, at: Date.now() };
}

/** The cached measurement for one SY; starts one in the background when missing or old. Never waits. */
export function cachedRealized(chainId: number, sy: string | null | undefined): Realized | null {
  if (!sy || !rpcsFor(chainId).length) return null;
  const key = `${chainId}:${sy.toLowerCase()}`;
  const hit = cache.get(key);
  if ((!hit || Date.now() - hit.at > TTL_MS) && !loading.has(key)) {
    loading.add(key);
    void queued(chainId, () => measure(chainId, sy))
      .then((r) => {
        if (r) cache.set(key, r);
      })
      .catch(() => {})
      .finally(() => loading.delete(key));
  }
  return hit ?? null;
}
