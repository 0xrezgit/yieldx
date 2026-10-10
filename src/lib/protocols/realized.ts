/**
 * Realized base yield, measured on-chain: the growth of a Pendle SY's `exchangeRate()`
 * (underlying per SY share) between now and 1, 3, 7, 30, 60, 90 and 120 days ago. It is the yield the
 * market actually delivered, independent of the figure Pendle publishes — live data
 * showed the two can disagree badly (superWETH: 0% for 40 days, one 0.36% catch-up,
 * published as 25%).
 *
 * Reading past state needs an archive node. Free public endpoints that serve it are
 * used by default; `ARCHIVE_RPC_URLS` (JSON, chain id → URL) puts a keyed node first.
 * Ten calls per market (eight rates, the SY's reward tokens and the YT's PY index), cached six hours and
 * refreshed in the background. An exchange rate that does not move (rewards or rebasing
 * markets) is not measurable; `moved` says so, and `rewardTokens` whether the SY itself
 * pays any reward token (when it pays none, a published «reward» does not reach the YT
 * through the SY).
 *
 * Endpoints: each one listed here was checked on 2026-10-10 to return the state of a block
 * 120 days back (not just an answer — rpc.hyperliquid.xyz returns today's state for any
 * block, so it is not used). Monad has no keyless archive endpoint.
 */

const DEFAULT_RPCS: Record<number, string[]> = {
  1: ['https://gateway.tenderly.co/public/mainnet', 'https://rpc.mevblocker.io', 'https://eth.drpc.org'],
  10: ['https://mainnet.optimism.io', 'https://optimism.gateway.tenderly.co', 'https://optimism.drpc.org'],
  // bsc.drpc.org: the free plan refuses (rate limit); Blast answers archive.
  56: ['https://bsc-mainnet.public.blastapi.io'],
  130: ['https://unichain.drpc.org'],
  146: ['https://sonic.drpc.org'],
  196: ['https://xlayer.drpc.org', 'https://rpc.xlayer.tech'],
  999: ['https://hyperliquid.drpc.org'],
  4663: ['https://robinhood.drpc.org'],
  8453: ['https://base.drpc.org', 'https://base.gateway.tenderly.co'],
  9745: ['https://rpc.plasma.to', 'https://plasma.gateway.tenderly.co'],
  // arbitrum.drpc.org has no archive state («Unknown state»).
  42161: ['https://arbitrum-one.public.blastapi.io', 'https://arb-pokt.nodies.app', 'https://arbitrum.gateway.tenderly.co'],
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
  /** Realized APY over the last 1 and 3 days, %: whether the week's level still holds. */
  d1?: number | null;
  d3?: number | null;
  /** Realized APY over the last 30, 60, 90 and 120 days, %; null when the SY is younger. */
  d30: number | null;
  d60?: number | null;
  d90?: number | null;
  d120?: number | null;
  /** The week's growth came in a single step (a catch-up harvest), not steadily. */
  lumpy: boolean;
  /** The exchange rate changed at all over the 120 days; false → the yield is paid another way. */
  moved?: boolean;
  /** Reward tokens the SY pays (getRewardTokens); null when not read. */
  rewardTokens?: number | null;
  /**
   * What a PT redeems for, as a share of one unit: the SY's exchange rate over the YT's
   * `pyIndexStored` when the rate is below it (the market lost value since), else 1; null
   * when not read.
   */
  redeemFactor?: number | null;
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

/** Number of reward tokens the SY pays, from getRewardTokens() (an address[]); null when unreadable. */
async function rewardTokens(chainId: number, sy: string): Promise<number | null> {
  const r = await rpc(chainId, 'eth_call', [{ to: sy, data: '0xc4f59f9b' }, 'latest']);
  if (!r || r.length < 130) return null;
  const n = parseInt(r.slice(66, 130), 16);
  return Number.isFinite(n) ? n : null;
}

/** The YT's stored PY index (pyIndexStored(), 18 decimals); null when unreadable. */
async function pyIndex(chainId: number, yt: string | undefined): Promise<number | null> {
  if (!yt) return null;
  const r = await rpc(chainId, 'eth_call', [{ to: yt, data: '0xd2a3584e' }, 'latest']);
  return r ? Number(BigInt(r.slice(0, 66))) / 1e18 : null;
}

async function measure(chainId: number, sy: string, yt?: string): Promise<Realized | null> {
  const c = await chainClock(chainId);
  if (!c) return null;
  const blockAgo = (days: number) => Math.max(1, Math.round(c.head - (days * DAY) / c.secPerBlock));
  // Now, 1, 3 and 7 days ago tell a step from a slope inside the week; 30–120 days, whether
  // the week's level is the market's own or a passing burst.
  const [now, r1, r3, r7, r30, r60, r90, r120, tokens] = await Promise.all([
    rateAt(chainId, sy, c.head),
    ...[1, 3, 7, 30, 60, 90, 120].map((d) => rateAt(chainId, sy, blockAgo(d))),
    rewardTokens(chainId, sy),
  ] as const);
  if (now === null) return null;
  const py = await pyIndex(chainId, yt);
  const redeemFactor = py !== null && py > 0 ? Math.min(1, now / py) : null;
  const annual = (to: number, from: number, days: number) => (Math.pow(to / from, 365 / days) - 1) * 100;
  const at = (r: number | null, days: number) => (r !== null && r > 0 ? annual(now, r, days) : null);
  // A rate that never moved measures nothing (the yield is paid another way).
  const moved = [r1, r3, r7, r30, r60, r90, r120].some((x) => x !== null && x !== now);
  if (!moved) return { d7: null, d1: null, d3: null, d30: null, d60: null, d90: null, d120: null, lumpy: false, moved: false, rewardTokens: tokens, redeemFactor, at: Date.now() };
  const d30 = at(r30, 30);
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
  return { d7, d1: at(r1, 1), d3: at(r3, 3), d30, d60: at(r60, 60), d90: at(r90, 90), d120: at(r120, 120), lumpy, moved: true, rewardTokens: tokens, redeemFactor, at: Date.now() };
}

/** A stretch holding more than `share` of the week's growth at over `paceRatio` times the others' pace is a step. */
const LUMP = { share: 0.8, paceRatio: 5 } as const;

/** The cached measurement for one SY; starts one in the background when missing or old. Never waits. */
export function cachedRealized(chainId: number, sy: string | null | undefined, yt?: string): Realized | null {
  if (!sy || !rpcsFor(chainId).length) return null;
  const key = `${chainId}:${sy.toLowerCase()}`;
  const hit = cache.get(key);
  if ((!hit || Date.now() - hit.at > TTL_MS) && !loading.has(key)) {
    loading.add(key);
    void queued(chainId, () => measure(chainId, sy, yt))
      .then((r) => {
        if (r) cache.set(key, r);
      })
      .catch(() => {})
      .finally(() => loading.delete(key));
  }
  return hit ?? null;
}
