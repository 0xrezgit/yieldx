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
  /**
   * Realized APY over the last 7 days, %, with a one-step jump taken out: when nearly all of
   * the week's growth came in one of its three stretches, the steady pace of the others.
   */
  d7: number | null;
  /** Realized APY over the last 30 days, %. */
  d30: number | null;
  /** The week's growth came in a single step (a catch-up harvest), not steadily. */
  lumpy: boolean;
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
  // Now, 1, 3, 7 and 30 days ago: three stretches inside the week tell a step from a slope.
  const [now, r1, r3, r7, r30] = await Promise.all([rateAt(chainId, sy, c.head), rateAt(chainId, sy, blockAgo(1)), rateAt(chainId, sy, blockAgo(3)), rateAt(chainId, sy, blockAgo(7)), rateAt(chainId, sy, blockAgo(30))]);
  if (now === null) return null;
  const annual = (to: number, from: number, days: number) => (Math.pow(to / from, 365 / days) - 1) * 100;
  // A rate that never moved measures nothing (the yield is paid another way).
  const moved = [r1, r3, r7, r30].some((x) => x !== null && x !== now);
  if (!moved) return { d7: null, d30: null, lumpy: false, at: Date.now() };
  const d30 = r30 !== null && r30 > 0 ? annual(now, r30, 30) : null;
  let d7 = r7 !== null && r7 > 0 ? annual(now, r7, 7) : null;
  let lumpy = false;
  if (r1 !== null && r3 !== null && r7 !== null && r7 > 0 && now > r7) {
    const stretches = [
      { g: Math.log(r3 / r7), days: 4 },
      { g: Math.log(r1 / r3), days: 2 },
      { g: Math.log(now / r1), days: 1 },
    ];
    const total = Math.log(now / r7);
    const top = stretches.reduce((a, b) => (b.g > a.g ? b : a));
    if (top.g > LUMP.share * total) {
      // Nearly all of the week in one stretch: the others give the steady pace.
      const rest = stretches.filter((x) => x !== top);
      const restDays = rest.reduce((a, x) => a + x.days, 0);
      const restG = rest.reduce((a, x) => a + x.g, 0);
      const pace = (Math.exp((restG * 365) / restDays) - 1) * 100;
      if ((top.g * 365) / top.days > LUMP.paceRatio * Math.max((restG * 365) / restDays, 1e-9)) {
        lumpy = true;
        d7 = pace;
      }
    }
  }
  return { d7, d30, lumpy, at: Date.now() };
}

/** A stretch holding more than `share` of the week's growth at over `paceRatio` times the others' pace is a step. */
const LUMP = { share: 0.8, paceRatio: 5 } as const;

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
