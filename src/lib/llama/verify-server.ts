import 'server-only';
import config from '../../config/verify.json';
import { mapLimit } from '../protocols/base';
import { allPools, getJson } from './server';
import { dailyYields, feeBps, fromPrices, growthFromPrices, instantShare, MAX_MEASURED_PCT, onePerContract, type ExitStatus, type HolderSim, type VerifiedFeed, type VerifiedPool, type VerifyReject } from './verify';
import type { YieldPool } from './yields';
import { robustRate } from '../opportunity/robust-rate';
import { createStore, type Kind } from './verify-store';

/**
 * YieldX's own on-chain verification of DefiLlama pools (see `verify.ts` for the
 * method). Free sources only: DefiLlama's pool list and per-pool address, keyless
 * archive RPCs, and per chain one source of holders: Blockscout, Routescan, or the
 * vault's own Transfer logs of the last days (see `verify.json`).
 *
 * Work is per pool and per day (00:00 UTC block) and kept here; it runs in the
 * background — a request waits a few seconds at most and reports the rest as
 * pending, largest pools first. Past share prices never change and are kept for good.
 */

type HolderSource = { source: 'blockscout'; url: string } | { source: 'blockscout-pro' } | { source: 'routescan' } | { source: 'logs'; range: number; days: number };

interface ChainCfg {
  chainId: number;
  blockTimeS: number;
  /** Address pages for the screen. */
  explorer: string;
  holders: HolderSource;
  rpc: string[];
  /** Calls in flight at once on this chain's RPCs (free endpoints rate-limit bursts). */
  rpcConcurrency?: number;
}

const CFG = config;
/** Blockscout's multichain PRO API (free key at dev.blockscout.com); chains that need it run only with it. */
const BLOCKSCOUT_KEY = process.env.BLOCKSCOUT_API_KEY?.trim() || null;
const CHAINS = Object.fromEntries(Object.entries(config.chains as unknown as Record<string, ChainCfg>).filter(([, c]) => c.holders.source !== 'blockscout-pro' || BLOCKSCOUT_KEY)) as Record<string, ChainCfg>;
const DAY_MS = 86_400_000;
const TIMEOUT_MS = 15_000;
/** Pools verified at a time on each chain; each makes ~25 calls, a few at a time. */
const POOL_CONCURRENCY = 2;
const CALL_CONCURRENCY = 3;
/** How long a request waits for missing pools before answering with what is ready. */
const WAIT_MS = 6_000;
/** A pool that failed for a network reason is tried again after this long. */
const RETRY_MS = 30 * 60_000;
/** A pool's address does not change; DefiLlama is asked again after a week. */
const ADDRESS_TTL_MS = 7 * DAY_MS;
const HEADERS = { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (compatible; YieldX)' };

class Reverted extends Error {
  constructor(
    message?: string,
    /** The revert's data (custom error selector and arguments), when the endpoint gives it. */
    readonly data?: string,
  ) {
    super(message);
  }
}
class VerifyUpstreamError extends Error {}

// ─── JSON-RPC ────────────────────────────────────────────────────────────────

let turn = 0;
const DEFAULT_RPC_CONCURRENCY = 4;
/** Rounds over all of a chain's endpoints before a call fails; a pause grows between rounds. */
const RPC_ROUNDS = 3;
const inFlightCalls = new Map<number, number>();
const waiting = new Map<number, (() => void)[]>();

/** A slot among the chain's calls in flight. */
async function slot(chain: ChainCfg): Promise<() => void> {
  const max = chain.rpcConcurrency ?? DEFAULT_RPC_CONCURRENCY;
  while ((inFlightCalls.get(chain.chainId) ?? 0) >= max) await new Promise<void>((r) => waiting.set(chain.chainId, [...(waiting.get(chain.chainId) ?? []), r]));
  inFlightCalls.set(chain.chainId, (inFlightCalls.get(chain.chainId) ?? 0) + 1);
  return () => {
    inFlightCalls.set(chain.chainId, (inFlightCalls.get(chain.chainId) ?? 1) - 1);
    waiting.get(chain.chainId)?.shift()?.();
  };
}

/**
 * One call, spread over the chain's endpoints: the next endpoint on a network error or
 * rate limit, and after a full round a pause and another round.
 */
async function rpc<T = string>(chain: ChainCfg, method: string, params: unknown[]): Promise<T> {
  const release = await slot(chain);
  try {
    const urls = chain.rpc;
    const first = turn++;
    let last: unknown = null;
    for (let round = 0; round < RPC_ROUNDS; round++) {
      if (round) await new Promise((r) => setTimeout(r, 1_500 * round));
      for (let i = 0; i < urls.length; i++) {
        const url = urls[(first + i) % urls.length];
        try {
          const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
          const body = (await res.json()) as { result?: T; error?: { code?: number; message?: string; data?: unknown } };
          if (body.error) {
            // A revert is the contract's answer, not the endpoint's failure.
            if (body.error.code === 3 || /revert/i.test(body.error.message ?? '')) throw new Reverted(body.error.message, typeof body.error.data === 'string' ? body.error.data : undefined);
            last = new VerifyUpstreamError(body.error.message);
            continue;
          }
          if (body.result === undefined || body.result === null) throw new VerifyUpstreamError('no result');
          return body.result;
        } catch (e) {
          if (e instanceof Reverted) throw e;
          last = e;
        }
      }
    }
    throw last instanceof Error ? last : new VerifyUpstreamError('rpc unreachable');
  } finally {
    release();
  }
}

const word = (a: string) => a.slice(2).toLowerCase().padStart(64, '0');
const uint = (x: bigint) => x.toString(16).padStart(64, '0');
const hexBlock = (b: number) => `0x${b.toString(16)}`;

/** eth_call → the first returned word; empty return data counts as a revert (no such function). */
async function call(chain: ChainCfg, to: string, data: string, block: number, from?: string, override?: Record<string, { code: string }>): Promise<bigint> {
  const out = await rpc(chain, 'eth_call', [{ to, data, ...(from ? { from } : {}) }, hexBlock(block), ...(override ? [override] : [])]);
  if (out === '0x' || out.length < 66) throw new Reverted('empty');
  return BigInt(out.slice(0, 66));
}

const SEL = {
  asset: '0x38d52e0f',
  decimals: '0x313ce567',
  totalAssets: '0x01e1d114',
  totalSupply: '0x18160ddd',
  convertToAssets: '0x07a2d13a',
  balanceOf: '0x70a08231',
  maxRedeem: '0xd905777e',
  redeem: '0xba087652',
  // Aave V3 and its forks (SparkLend): the deposit token and its pool.
  underlying: '0xb16a19de', // UNDERLYING_ASSET_ADDRESS()
  pool: '0x7535d246', // POOL()
  normalizedIncome: '0xd15e0053', // getReserveNormalizedIncome(address), ray (1e27)
  withdraw: '0x69328dec', // withdraw(address,uint256,address)
};
/**
 * Aave: the withdrawal would leave the holder's own loan under-collateralised — the
 * custom error of Aave 3.2+, or the string code "35" of Aave 3.0 and its forks (SparkLend).
 */
const HEALTH_FACTOR_ERROR = '0x6679996d';
const HEALTH_FACTOR_CODE = '35';

/** `Error(string)` revert data → its text. */
function revertText(data: string | undefined): string | null {
  if (!data?.startsWith('0x08c379a0') || data.length < 138) return null;
  const len = parseInt(data.slice(74, 138), 16);
  return Buffer.from(data.slice(138, 138 + len * 2), 'hex').toString();
}

const isCollateralRevert = (e: Reverted) => !!e.data?.startsWith(HEALTH_FACTOR_ERROR) || revertText(e.data) === HEALTH_FACTOR_CODE;

// ─── Block at a moment (RPC only) ────────────────────────────────────────────

interface Header {
  n: number;
  ts: number;
}

async function header(chain: ChainCfg, block: number | 'latest'): Promise<Header> {
  const h = await rpc<{ number?: string; timestamp?: string }>(chain, 'eth_getBlockByNumber', [block === 'latest' ? 'latest' : hexBlock(block), false]);
  const n = Number(h.number);
  const ts = Number(h.timestamp);
  if (!Number.isFinite(n) || !Number.isFinite(ts)) throw new VerifyUpstreamError('bad header');
  return { n, ts };
}

/** Block search: interpolation by timestamp, every other step a bisection so it always converges. */
async function findBlock(chain: ChainCfg, target: number): Promise<number> {
  let hi = await header(chain, 'latest');
  if (hi.ts <= target) return hi.n;
  // A lower bound: step back by a guessed block time, doubling until before the moment.
  let span = Math.max(1, Math.ceil((hi.ts - target) / chain.blockTimeS));
  let lo = await header(chain, Math.max(0, hi.n - span));
  while (lo.ts > target && lo.n > 0) {
    hi = lo;
    span *= 2;
    lo = await header(chain, Math.max(0, hi.n - span));
  }
  for (let i = 0; hi.n - lo.n > 1; i++) {
    const guess = i % 2 ? Math.floor((lo.n + hi.n) / 2) : lo.n + Math.floor(((target - lo.ts) * (hi.n - lo.n)) / (hi.ts - lo.ts));
    const mid = await header(chain, Math.min(hi.n - 1, Math.max(lo.n + 1, guess)));
    if (mid.ts <= target) lo = mid;
    else hi = mid;
  }
  return lo.n;
}

const blocks = new Map<string, Promise<number>>();
/** The same blocks once found, for the disk copy. */
const blockValues = new Map<string, number>();

/** A search shared by every pool of that day: a passing network error must not fail them all. */
async function findBlockRetried(chain: ChainCfg, target: number): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await findBlock(chain, target);
    } catch (e) {
      if (attempt >= 2) throw e;
      await new Promise((r) => setTimeout(r, 1_000 * (attempt + 1)));
    }
  }
}

/** The last block at or before a moment (unix ms); one search per chain and moment. */
function blockAt(chainName: string, ms: number): Promise<number> {
  const key = `${chainName}:${ms}`;
  let hit = blocks.get(key);
  if (!hit) {
    hit = findBlockRetried(CHAINS[chainName], Math.floor(ms / 1000));
    blocks.set(key, hit);
    hit.then((n) => (blockValues.set(key, n), store.mark('block', key))).catch(() => blocks.delete(key));
  }
  return hit;
}

// ─── Holders ─────────────────────────────────────────────────────────────────

/** Free explorer APIs allow a few requests a second: one at a time per host, spaced, retried on 429. */
const EXPLORER_GAP_MS = 350;
const queues = new Map<string, Promise<unknown>>();

function explorerGet<T>(url: string): Promise<T> {
  const host = new URL(url).host;
  const run = async (): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, { headers: HEADERS, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.status === 429 && attempt < 3) {
        await new Promise((r) => setTimeout(r, 2_000 * (attempt + 1)));
        continue;
      }
      if (!res.ok) throw new VerifyUpstreamError(`${host} ${res.status}`);
      return (await res.json()) as T;
    }
  };
  const next = (queues.get(host) ?? Promise.resolve()).then(() => new Promise((r) => setTimeout(r, EXPLORER_GAP_MS))).then(run);
  queues.set(
    host,
    next.catch(() => undefined),
  );
  return next;
}

interface Holder {
  address: string;
  name: string | null;
  contract: boolean | null;
}

interface Holders {
  list: Holder[];
  /** All holders, when the source says. */
  count: number | null;
  /** From recent Transfer logs only: a large holder that did not move may be missing. */
  partial: boolean;
}

const ZERO = '0x0000000000000000000000000000000000000000';
/** Holders tried, largest first, until `CFG.holders` are simulated: Aave borrowers (collateral) are skipped past. */
const MAX_TRIED = 15;
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
/** Routescan pages hold up to this many holders; its order is not by balance, so they are sorted here. */
const ROUTESCAN_PAGE = 1000;
/** Most recent receivers whose balance is read when holders come from logs. */
const LOG_CANDIDATES = 150;

async function holdersOf(chainName: string, chain: ChainCfg, vault: string, block: number, day: number): Promise<Holders> {
  const h = chain.holders;
  if (h.source === 'blockscout' || h.source === 'blockscout-pro') {
    const base = h.source === 'blockscout' ? h.url : `https://api.blockscout.com/${chain.chainId}`;
    const key = h.source === 'blockscout-pro' ? `?apikey=${encodeURIComponent(BLOCKSCOUT_KEY ?? '')}` : '';
    const [info, page] = await Promise.all([
      explorerGet<{ holders_count?: string }>(`${base}/api/v2/tokens/${vault}${key}`).catch(() => null),
      explorerGet<{ items?: { address?: { hash?: string; name?: string | null; is_contract?: boolean } }[] }>(`${base}/api/v2/tokens/${vault}/holders${key}`),
    ]);
    const list = (page.items ?? []).flatMap((x) => (x.address?.hash && x.address.hash !== ZERO ? [{ address: x.address.hash, name: x.address.name ?? null, contract: x.address.is_contract ?? null }] : []));
    return { list: list.slice(0, MAX_TRIED), count: Number(info?.holders_count) || null, partial: false };
  }
  if (h.source === 'routescan') {
    const body = await explorerGet<{ status?: string; result?: { TokenHolderAddress?: string; TokenHolderQuantity?: string }[] | null }>(
      `https://api.routescan.io/v2/network/mainnet/evm/${chain.chainId}/etherscan/api?module=token&action=tokenholderlist&contractaddress=${vault}&page=1&offset=${ROUTESCAN_PAGE}`,
    );
    const rows = (body.result ?? []).filter((r) => r.TokenHolderAddress && r.TokenHolderAddress !== ZERO && /^\d+$/.test(r.TokenHolderQuantity ?? ''));
    rows.sort((a, b) => (BigInt(b.TokenHolderQuantity!) > BigInt(a.TokenHolderQuantity!) ? 1 : -1));
    return { list: rows.slice(0, MAX_TRIED).map((r) => ({ address: r.TokenHolderAddress!, name: null, contract: null })), count: rows.length < ROUTESCAN_PAGE ? rows.length : null, partial: false };
  }
  // Receivers in the vault's Transfer logs over the last days, newest first; then their balances.
  const from = await blockAt(chainName, day - h.days * DAY_MS);
  const seen: string[] = [];
  for (let to = block; to > from && seen.length < LOG_CANDIDATES; to -= h.range) {
    const start = Math.max(from, to - h.range + 1);
    const logs = await rpc<{ topics?: string[] }[]>(chain, 'eth_getLogs', [{ address: vault, topics: [TRANSFER], fromBlock: hexBlock(start), toBlock: hexBlock(to) }]);
    for (const l of [...logs].reverse()) {
      const addr = l.topics?.[2] ? `0x${l.topics[2].slice(26)}` : null;
      if (addr && addr !== ZERO && !seen.includes(addr)) seen.push(addr);
    }
  }
  const balances: { address: string; shares: bigint }[] = [];
  await mapLimit(seen.slice(0, LOG_CANDIDATES), CALL_CONCURRENCY, async (address) => {
    balances.push({ address, shares: await call(chain, vault, SEL.balanceOf + word(address), block) });
  });
  balances.sort((a, b) => (b.shares > a.shares ? 1 : -1));
  return { list: balances.filter((b) => b.shares > BigInt(0)).slice(0, MAX_TRIED).map((b) => ({ address: b.address, name: null, contract: null })), count: null, partial: true };
}

/** Whether an address has code, when the holder source did not say. */
async function hasCode(chain: ChainCfg, address: string, block: number): Promise<boolean> {
  try {
    return (await rpc(chain, 'eth_getCode', [address, hexBlock(block)])).length > 2;
  } catch {
    return false;
  }
}

// ─── Per pool ────────────────────────────────────────────────────────────────

const addresses = new Map<string, { at: number; value: string | null }>();

/** The vault's contract, from DefiLlama's per-pool record (`pool_old`: "0x…-ethereum", "morpho-vault-v2-0x…"). */
async function vaultAddress(id: string, now: number): Promise<string | null> {
  const hit = addresses.get(id);
  if (hit && now - hit.at < ADDRESS_TTL_MS) return hit.value;
  const body = await getJson<{ data?: { pool_old?: string }[] }>(`https://yields.llama.fi/poolsEnriched?pool=${encodeURIComponent(id)}`, { cache: 'no-store' });
  const value = /0x[0-9a-fA-F]{40}/.exec(body.data?.[0]?.pool_old ?? '')?.[0] ?? null;
  addresses.set(id, { at: now, value });
  store.mark('address', id);
  return value;
}

async function decimals(chain: ChainCfg, token: string, block: number): Promise<number> {
  try {
    return Number(await call(chain, token, SEL.decimals, block));
  } catch {
    return 18;
  }
}

const asAddress = (x: bigint) => `0x${x.toString(16).padStart(40, '0')}`;

/** Past prices never change once a day is past. */
const prices = new Map<string, number | null>();

/** A price read, kept for good; null when the contract did not exist yet (the call reverts). */
async function cachedPrice(key: string, read: () => Promise<bigint>, scale: number): Promise<number | null> {
  if (prices.has(key)) return prices.get(key)!;
  let value: number | null;
  try {
    value = Number(await read()) / scale;
  } catch (e) {
    if (!(e instanceof Reverted)) throw e;
    value = null;
  }
  prices.set(key, value);
  store.mark('price', key);
  return value;
}

/**
 * Some vaults pay out through a token the receiver must accept (apyUSD mints an
 * ERC-721 to the caller), which a holder that is a contract may refuse even though
 * the vault has the money. Such a refusal is simulated again with the holder as a
 * plain wallet (its code removed for that one call, a state override) and marked
 * `asWallet`: the vault could pay, the holder's own contract is what refuses.
 */
type Sim = { status: ExitStatus; out: bigint; asWallet: boolean };

/**
 * One way of reading a deposit contract. ERC-4626: the share price and `redeem`.
 * Aave V3 (and forks): the reserve's income index and `Pool.withdraw`; its token's
 * balance already counts in the asset, and the index plays the share price's part.
 */
interface Model {
  kind: VerifiedPool['kind'];
  assetScale: number;
  /** Asset per unit at a block (share price or income index); null before it existed. */
  price(block: number): Promise<number | null>;
  /** The holder's units and what they are worth in the asset. */
  position(holder: string, block: number): Promise<{ raw: bigint; value: number }>;
  simulate(holder: string, raw: bigint, block: number): Promise<Sim>;
  /** All units, and what they are worth in the asset. */
  totals(block: number): Promise<{ raw: bigint; assets: number }>;
  /** Share of deposits that is idle cash, withdrawable now (Aave); null for vaults. */
  liquidityPct(block: number): Promise<number | null>;
}

async function erc4626(chain: ChainCfg, vault: string, block: number): Promise<Model | null> {
  let asset: string;
  try {
    asset = asAddress(await call(chain, vault, SEL.asset, block));
    await call(chain, vault, SEL.convertToAssets + uint(BigInt(1)), block);
  } catch (e) {
    if (e instanceof Reverted) return null;
    throw e;
  }
  const [vaultDec, assetDec] = await Promise.all([decimals(chain, vault, block), decimals(chain, asset, block)]);
  const one = BigInt(10) ** BigInt(vaultDec);
  const assetScale = 10 ** assetDec;
  const redeem = async (holder: string, n: bigint, b: number): Promise<{ out: bigint; asWallet: boolean } | null> => {
    const data = SEL.redeem + uint(n) + word(holder) + word(holder);
    for (const asWallet of [false, true]) {
      try {
        return { out: await call(chain, vault, data, b, holder, asWallet ? { [holder]: { code: '0x' } } : undefined), asWallet };
      } catch (e) {
        if (!(e instanceof Reverted)) throw e;
      }
    }
    return null;
  };
  return {
    kind: 'erc4626',
    assetScale,
    price: (b) => cachedPrice(`${chain.chainId}:${vault}:${b}`, () => call(chain, vault, SEL.convertToAssets + uint(one), b), assetScale),
    async position(holder, b) {
      const raw = await call(chain, vault, SEL.balanceOf + word(holder), b);
      return { raw, value: raw > BigInt(0) ? Number(await call(chain, vault, SEL.convertToAssets + uint(raw), b)) / assetScale : 0 };
    },
    // Redeem the whole balance as the holder would; if refused, whatever `maxRedeem` allows.
    async simulate(holder, raw, b) {
      const full = await redeem(holder, raw, b);
      if (full) return { status: 'full', ...full };
      let max = BigInt(0);
      try {
        max = await call(chain, vault, SEL.maxRedeem + word(holder), b);
      } catch (e) {
        if (!(e instanceof Reverted)) throw e;
      }
      if (max > BigInt(0) && max < raw) {
        const part = await redeem(holder, max, b);
        if (part) return { status: 'partial', ...part };
      }
      return { status: 'blocked', out: BigInt(0), asWallet: false };
    },
    async totals(b) {
      const [assets, raw] = await Promise.all([call(chain, vault, SEL.totalAssets, b), call(chain, vault, SEL.totalSupply, b)]);
      return { raw, assets: Number(assets) / assetScale };
    },
    liquidityPct: async () => null,
  };
}

async function aave(chain: ChainCfg, token: string, block: number): Promise<Model | null> {
  let asset: string;
  let pool: string;
  try {
    [asset, pool] = (await Promise.all([call(chain, token, SEL.underlying, block), call(chain, token, SEL.pool, block)])).map(asAddress);
    await call(chain, pool, SEL.normalizedIncome + word(asset), block);
  } catch (e) {
    if (e instanceof Reverted) return null;
    throw e;
  }
  const assetScale = 10 ** (await decimals(chain, asset, block));
  const withdraw = (holder: string, n: bigint, b: number) => call(chain, pool, SEL.withdraw + word(asset) + uint(n) + word(holder), b, holder);
  const cash = (b: number) => call(chain, asset, SEL.balanceOf + word(token), b);
  return {
    kind: 'aave',
    assetScale,
    price: (b) => cachedPrice(`${chain.chainId}:${token}:aave:${b}`, () => call(chain, pool, SEL.normalizedIncome + word(asset), b), 1e27),
    async position(holder, b) {
      const raw = await call(chain, token, SEL.balanceOf + word(holder), b);
      return { raw, value: Number(raw) / assetScale };
    },
    async simulate(holder, raw, b) {
      try {
        return { status: 'full', out: await withdraw(holder, raw, b), asWallet: false };
      } catch (e) {
        if (!(e instanceof Reverted)) throw e;
        // The deposit backs the holder's own loan: their situation, not the pool's liquidity.
        if (isCollateralRevert(e)) return { status: 'collateral', out: BigInt(0), asWallet: false };
      }
      // More than the pool's idle cash: what the cash allows. Aave's own cash accounting
      // (virtual balance) can sit a little under the token balance, so slightly less is tried too.
      const free = await cash(b);
      if (free > BigInt(0) && free < raw) {
        for (const n of [free, (free * BigInt(99)) / BigInt(100), free / BigInt(2)]) {
          try {
            return { status: 'partial', out: await withdraw(holder, n, b), asWallet: false };
          } catch (e) {
            if (!(e instanceof Reverted)) throw e;
          }
        }
      }
      return { status: 'blocked', out: BigInt(0), asWallet: false };
    },
    async totals(b) {
      const raw = await call(chain, token, SEL.totalSupply, b);
      return { raw, assets: Number(raw) / assetScale };
    },
    async liquidityPct(b) {
      const [free, supply] = await Promise.all([cash(b), call(chain, token, SEL.totalSupply, b)]);
      return supply > BigInt(0) ? Math.min(100, (Number(free) / Number(supply)) * 100) : null;
    },
  };
}

/** The contract's model: ERC-4626 first, then Aave; null when neither answers. */
async function modelOf(chain: ChainCfg, address: string, block: number): Promise<Model | null> {
  return (await erc4626(chain, address, block)) ?? (await aave(chain, address, block));
}


type Outcome = { ok: true; value: VerifiedPool } | { ok: false; reason: VerifyReject };

async function verify(p: YieldPool, day: number, now: number): Promise<Outcome> {
  const chain = CHAINS[p.chain];
  const address = await vaultAddress(p.id, now);
  if (!address) return { ok: false, reason: 'address' };
  const block = await blockAt(p.chain, day);
  const model = await modelOf(chain, address, block);
  if (!model) return { ok: false, reason: 'not4626' };

  // Price at today's block and every day back over the window, plus the long window.
  // Past days never change and are kept: after the first pass, one new read a day.
  const uniq = [...Array.from({ length: CFG.windowDays + 1 }, (_, d) => d), CFG.longDays];
  const pps = new Map<number, number | null>();
  await mapLimit(uniq, CALL_CONCURRENCY, async (d) => {
    const b = d === 0 ? block : await blockAt(p.chain, day - d * DAY_MS);
    pps.set(d, await model.price(b));
  });
  // A failed call (network) leaves a gap: try the whole pool again later rather than guess.
  if (pps.size !== uniq.length) throw new VerifyUpstreamError('price missing');
  if (pps.get(0) === null) return { ok: false, reason: 'young' };
  const { measured, stability } = fromPrices(pps, CFG.stepDays, CFG.windowDays, CFG.longDays);
  // The rate ranked on: daily yields, jump days out, the window chosen by the pattern.
  const longDays = pps.get(CFG.longDays) !== null ? CFG.longDays : [...pps.entries()].filter(([, v]) => v !== null).reduce((m, [d]) => Math.max(m, d), 0);
  const robust = robustRate(dailyYields(pps, CFG.windowDays), measured.d90 ?? measured.d30, longDays);
  if (robust.pct === null) return { ok: false, reason: robust.reason === 'too-short' ? 'young' : 'price' };
  // A rate past the plausible ceiling even after the jump days is not a yield.
  if (robust.pct > MAX_MEASURED_PCT) return { ok: false, reason: 'price' };

  // Real holders, largest first; each exits in full at the same block.
  const [holders, totals, liquidityPct] = await Promise.all([holdersOf(p.chain, chain, address, block, day), model.totals(block), model.liquidityPct(block)]);
  if (!holders.list.length) return { ok: false, reason: 'holders' };
  const usdPerAsset = totals.assets > 0 ? p.tvlUsd / totals.assets : 0;

  const sims: HolderSim[] = [];
  const counted = () => sims.filter((h) => h.status !== 'collateral').length;
  const queue = holders.list.slice(0, MAX_TRIED);
  while (queue.length && counted() < CFG.holders) {
    const batch = queue.splice(0, Math.min(CALL_CONCURRENCY, CFG.holders - counted()));
    await Promise.all(
      batch.map(async (h) => {
        const pos = await model.position(h.address, block);
        if (pos.raw === BigInt(0)) return;
        const [sim, contract] = await Promise.all([model.simulate(h.address, pos.raw, block), h.contract ?? hasCode(chain, h.address, block)]);
        const out = Number(sim.out) / model.assetScale;
        sims.push({
          address: h.address,
          name: h.name,
          contract,
          value: pos.value,
          usd: pos.value * usdPerAsset,
          sharePct: totals.raw > BigInt(0) ? (Number(pos.raw) / Number(totals.raw)) * 100 : 0,
          status: sim.status,
          asWallet: sim.asWallet,
          out,
          feeBps: feeBps(pos.value, out),
        });
      }),
    );
  }
  if (!counted()) return { ok: false, reason: 'holders' };
  sims.sort((a, b) => b.value - a.value);
  const coveredPct = sims.filter((h) => h.status !== 'collateral').reduce((s, h) => s + h.sharePct, 0);
  // Holders from recent logs only: too little of the vault covered to say anything about exits.
  if (holders.partial && coveredPct < CFG.minLogCoveragePct) return { ok: false, reason: 'holders' };
  // A young vault held almost entirely by one address (its deployer) is not tested by anyone else.
  if (robust.young && sims.some((h) => h.sharePct >= CFG.youngMaxHolderPct)) return { ok: false, reason: 'holders' };

  return {
    ok: true,
    value: {
      ...p,
      address,
      kind: model.kind,
      block,
      day,
      measured,
      stability,
      robust,
      holdersCount: holders.count,
      holdersFromLogs: holders.partial ? (chain.holders as { days: number }).days : null,
      sims,
      instantPct: instantShare(sims),
      coveredPct,
      liquidityPct,
    },
  };
}

// ─── The feed ────────────────────────────────────────────────────────────────

interface Done {
  day: number;
  at: number;
  outcome: Outcome | null;
}

const results = new Map<string, Done>();
const inFlight = new Set<string>();

// A new server starts from the lasting copy (verify-store: Neon, else a local file):
// verified vaults show at once and only the rest is worked on.
const store = createStore<Done>({
  all: () => ({
    // Network failures are not kept: they are retried anyway.
    results: [...results].filter(([, r]) => r.outcome !== null),
    prices: [...prices],
    addresses: [...addresses],
    blocks: [...blockValues],
  }),
  one: (kind: Kind, key: string) => {
    if (kind === 'result') {
      const r = results.get(key);
      return r && r.outcome !== null ? r : undefined;
    }
    if (kind === 'price') return prices.has(key) ? prices.get(key) : undefined;
    if (kind === 'address') return addresses.get(key);
    return blockValues.get(key);
  },
});
const ready: Promise<void> = store.load().then((saved) => {
  if (!saved) return;
  // Memory wins over the copy: anything already worked on in this instance stays.
  for (const [k, v] of saved.results) if (!results.has(k)) results.set(k, v);
  for (const [k, v] of saved.prices) if (!prices.has(k)) prices.set(k, v);
  for (const [k, v] of saved.addresses) if (!addresses.has(k)) addresses.set(k, v);
  for (const [k, n] of saved.blocks) if (!blocks.has(k)) (blockValues.set(k, n), blocks.set(k, Promise.resolve(n)));
});

const today = (now: number) => Math.floor(now / DAY_MS) * DAY_MS;

/** Done for today, or failed recently (network) and not due again yet. */
const settled = (id: string, now: number) => {
  const r = results.get(id);
  if (!r) return false;
  if (r.outcome === null) return now - r.at < RETRY_MS;
  return r.day === today(now);
};

function fill(pools: YieldPool[], now: number): Promise<unknown> {
  const todo = pools.filter((p) => !inFlight.has(p.id));
  todo.forEach((p) => inFlight.add(p.id));
  // Chains have their own RPCs and holder sources: each chain runs on its own, largest pools first.
  const byChain = new Map<string, YieldPool[]>();
  for (const p of todo) byChain.set(p.chain, [...(byChain.get(p.chain) ?? []), p]);
  return Promise.all([...byChain.values()].map((list) => mapLimit(list, POOL_CONCURRENCY, (p) => verifyOne(p, now))));
}

async function verifyOne(p: YieldPool, now: number): Promise<void> {
  let outcome: Outcome | null;
  try {
    outcome = await verify(p, today(now), now);
  } catch (e) {
    // A revert past the first checks: the vault does not behave as ERC-4626 (async / ERC-7540 exits).
    outcome = e instanceof Reverted ? { ok: false, reason: 'not4626' } : null;
  }
  // A network failure keeps yesterday's verified result on screen until the retry.
  const prev = results.get(p.id);
  results.set(p.id, outcome === null && prev?.outcome?.ok ? { ...prev, at: Date.now() } : { day: today(now), at: Date.now(), outcome });
  inFlight.delete(p.id);
  store.mark('result', p.id);
}

export function candidates(pools: YieldPool[]): YieldPool[] {
  return pools.filter((p) => p.chain in CHAINS && p.single && p.tvlUsd >= CFG.minTvlUsd && (p.apy ?? 0) > 0).sort((a, b) => b.tvlUsd - a.tvlUsd);
}

export async function getVerified(now = Date.now()): Promise<{ feed: VerifiedFeed; background: Promise<unknown> | null }> {
  const [{ pools, refresh }] = await Promise.all([allPools(now), ready]);
  const list = candidates(pools);
  const missing = list.filter((p) => !settled(p.id, now));
  const work = missing.length ? fill(missing, now) : null;
  if (work) await Promise.race([work, new Promise((r) => setTimeout(r, WAIT_MS))]);

  const empty = (): Record<VerifyReject, number> => ({ address: 0, not4626: 0, young: 0, price: 0, holders: 0, duplicate: 0, error: 0 });
  const rejected = empty();
  const verified: VerifiedPool[] = [];
  const byChain: VerifiedFeed['byChain'] = Object.fromEntries(Object.keys(CHAINS).map((c) => [c, { candidates: 0, verified: 0, pending: 0, rejected: empty() }]));
  let pending = 0;
  for (const p of list) {
    const r = results.get(p.id);
    const o = r?.outcome;
    const c = byChain[p.chain];
    c.candidates++;
    if (!r) (pending++, c.pending++);
    else if (!o) (rejected.error++, c.rejected.error++);
    // Today's list numbers (TVL, announced rate) over the verified result.
    else if ('value' in o) (verified.push({ ...o.value, ...p }), c.verified++);
    else (rejected[o.reason]++, c.rejected[o.reason]++);
  }
  const { kept, dropped } = onePerContract(verified);
  for (const p of dropped) {
    rejected.duplicate++;
    byChain[p.chain].rejected.duplicate++;
    byChain[p.chain].verified--;
  }
  return {
    feed: { pools: kept, pending, rejected, byChain, candidates: list.length, explorers: Object.fromEntries(Object.entries(CHAINS).map(([k, c]) => [k, c.explorer])), chainIds: Object.fromEntries(Object.entries(CHAINS).map(([k, c]) => [k, c.chainId])), minTvlUsd: CFG.minTvlUsd, fetchedAt: new Date(now).toISOString() },
    // The run's last results are written before the function may be frozen (Vercel).
    background: work || refresh ? Promise.all([work, refresh]).finally(() => store.flush()) : null,
  };
}

/** A deposit from `fromMs` (a day, 00:00 UTC) to the latest verified day, by the on-chain price. */
export async function verifiedGrowth(id: string, amount: number, fromMs: number) {
  await ready;
  const o = results.get(id)?.outcome;
  if (!o || !('value' in o)) return null;
  const v = o.value;
  const chain = CHAINS[v.chain];
  const start = today(fromMs);
  if (!(start < v.day)) return null;
  const [block, model] = await Promise.all([blockAt(v.chain, start), modelOf(chain, v.address, v.block)]);
  if (!model) return null;
  const [a, b] = await Promise.all([model.price(block), model.price(v.block)]);
  if (a === null || b === null) return { tooEarly: true as const };
  const g = growthFromPrices(amount, a, b, (v.day - start) / DAY_MS);
  return g ? { ...g, from: start, to: v.day } : null;
}
