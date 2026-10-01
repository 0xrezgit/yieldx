import 'server-only';
import { normalizeOpportunity, normalizeProgram, normalizeToken, type RawOpportunity, type RawProgram, type RawToken } from './normalize';
import { mapLimit } from '../protocols/base';
import { DEX_CHAINS, marketFromPairs, type RawPair } from './markets';
import { dedupe, isMeme, isRobinhoodChain, tokenClass } from './vetting';
import { tokenKey, type GasQuote, type MerklFeed, type MerklOpportunity, type MerklProgram, type MerklToken, type SellQuote, type TokenMarket } from './types';

/**
 * Server-side Merkl client. The API key (MERKL_API_KEY, set in the Vercel project
 * settings — never NEXT_PUBLIC_) is read only here and sent as `X-API-Key`. The
 * public endpoints also work without it, at the default rate limit.
 *
 * Freshness: the browser asks every minute; each upstream is cached in Next's
 * data cache for REVALIDATE_S, so any number of visitors costs one refresh per
 * window. The browser never reaches Merkl directly and can't choose the query.
 *
 * Also fetched here, never from the browser: DexScreener (reward-token liquidity
 * and an independent price) and Ethereum's gas price from a public RPC.
 */

const API = 'https://api.merkl.xyz/v4';
const REVALIDATE_S = 60;
const DEX_REVALIDATE_S = 120;
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
const TIMEOUT_MS = 20_000;
const DEX_BATCH = 30;
const ETH_RPC = 'https://ethereum-rpc.publicnode.com';

export class MerklUpstreamError extends Error {}

function headers(): HeadersInit {
  const key = process.env.MERKL_API_KEY?.trim();
  return key ? { accept: 'application/json', 'X-API-Key': key } : { accept: 'application/json' };
}

async function get<T>(path: string): Promise<{ body: T; date: number | null }> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      headers: headers(),
      next: { revalidate: REVALIDATE_S, tags: ['merkl'] },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    } as RequestInit);
  } catch {
    throw new MerklUpstreamError('Merkl API unreachable');
  }
  // The status only, never the request: headers carry the key.
  if (!res.ok) throw new MerklUpstreamError(`Merkl API responded with ${res.status}`);
  const date = Date.parse(res.headers.get('date') ?? '');
  return { body: (await res.json()) as T, date: Number.isFinite(date) ? date : null };
}

async function fetchPrograms(): Promise<MerklProgram[]> {
  try {
    const { body } = await get<RawProgram[]>(`/programs?items=${PAGE_SIZE}`);
    return (Array.isArray(body) ? body : []).map(normalizeProgram).filter((p): p is MerklProgram => p !== null);
  } catch {
    // Programs only name and describe; opportunities still carry their program links.
    return [];
  }
}

async function fetchLive(): Promise<{ opportunities: MerklOpportunity[]; fetchedAt: number }> {
  const { body: count } = await get<number>('/opportunities/count?status=LIVE');
  const pages = Math.min(MAX_PAGES, Math.max(1, Math.ceil((Number(count) || 0) / PAGE_SIZE)));
  const results = await Promise.all(
    Array.from({ length: pages }, (_, p) => get<RawOpportunity[]>(`/opportunities?status=LIVE&items=${PAGE_SIZE}&page=${p}&campaigns=true`)),
  );
  const now = Date.now() / 1000;
  const opportunities: MerklOpportunity[] = [];
  for (const { body } of results) {
    for (const raw of Array.isArray(body) ? body : []) {
      const o = normalizeOpportunity(raw, now);
      if (o && o.campaigns.length) opportunities.push(o);
    }
  }
  const dates = results.map((r) => r.date).filter((d): d is number => d !== null);
  // Pages can shift while being read, and one market can appear under several ids: one copy each.
  // The oldest page decides how fresh the whole list is (cached pages keep their original Date).
  return { opportunities: dedupe(opportunities), fetchedAt: dates.length ? Math.min(...dates) : Date.now() };
}

// ─── DexScreener ─────────────────────────────────────────────────────────────

/** Tokens whose liquidity matters: priced reward tokens that are not verified majors, and Robinhood-Chain memes. */
function tokensToCheck(list: MerklOpportunity[]): MerklToken[] {
  const m = new Map<string, MerklToken>();
  for (const o of list) {
    for (const c of o.campaigns) {
      const t = c.rewardToken;
      if (t.type === 'TOKEN' && t.price !== null && !(t.verified && tokenClass(t) !== 'other')) m.set(tokenKey(t.chainId, t.address), t);
    }
    for (const t of o.tokens) if (isRobinhoodChain(t.chainId) && isMeme(t)) m.set(tokenKey(t.chainId, t.address), t);
  }
  return [...m.values()].filter((t) => DEX_CHAINS[t.chainId] && /^0x[0-9a-fA-F]{40}$/.test(t.address));
}

async function fetchMarkets(list: MerklOpportunity[]): Promise<Record<string, TokenMarket | null>> {
  const byChain = new Map<number, string[]>();
  for (const t of tokensToCheck(list)) byChain.set(t.chainId, [...(byChain.get(t.chainId) ?? []), t.address.toLowerCase()]);
  const jobs: { chainId: number; addrs: string[] }[] = [];
  for (const [chainId, addrs] of byChain) {
    // Sorted, fixed batches: the same token set hits the same cache entries.
    const sorted = [...new Set(addrs)].sort();
    for (let i = 0; i < sorted.length; i += DEX_BATCH) jobs.push({ chainId, addrs: sorted.slice(i, i + DEX_BATCH) });
  }
  const out: Record<string, TokenMarket | null> = {};
  await Promise.all(
    jobs.map(async ({ chainId, addrs }) => {
      try {
        const res = await fetch(`https://api.dexscreener.com/tokens/v1/${DEX_CHAINS[chainId]}/${addrs.join(',')}`, {
          headers: { accept: 'application/json' },
          next: { revalidate: DEX_REVALIDATE_S, tags: ['dexscreener'] },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        } as RequestInit);
        if (!res.ok) return;
        const pairs = (await res.json()) as RawPair[];
        if (!Array.isArray(pairs)) return;
        for (const a of addrs) out[tokenKey(chainId, a)] = marketFromPairs(a, pairs);
      } catch {
        // Unknown stays unknown (no key): the estimate lists it instead of guessing.
      }
    }),
  );
  return out;
}

// ─── Sellability (KyberSwap) ─────────────────────────────────────────────────

/**
 * Chains KyberSwap's aggregator routes on (slugs checked live 2026-10-01). On other
 * chains a reward's sellability rests on its DexScreener market alone.
 */
export const KYBER_CHAINS: Record<number, string> = {
  1: 'ethereum', 10: 'optimism', 56: 'bsc', 130: 'unichain', 137: 'polygon', 143: 'monad', 146: 'sonic', 999: 'hyperevm',
  2020: 'ronin', 8453: 'base', 9745: 'plasma', 42161: 'arbitrum', 43114: 'avalanche', 59144: 'linea', 80094: 'berachain',
};
const KYBER = 'https://aggregator-api.kyberswap.com';
/** Size of the test sale, USD: large enough to meet real depth, small enough for any reward. */
const SELL_TEST_USD = 1_000;
const SELL_TTL_MS = 10 * 60_000;
const SELL_KEEP_MS = 60 * 60_000;
const sellCache = new Map<string, { q: SellQuote | null; at: number }>();
const underlyingCache = new Map<string, MerklToken | null>();
const refreshing = new Set<string>();

/** The token a Merkl wrapper turns into when claimed (Merkl's own token record). */
async function underlyingOf(t: MerklToken): Promise<MerklToken | null> {
  if (!t.underlyingId) return null;
  if (underlyingCache.has(t.underlyingId)) return underlyingCache.get(t.underlyingId) ?? null;
  try {
    const { body } = await get<RawToken[]>(`/tokens?id=${encodeURIComponent(t.underlyingId)}`);
    const u = Array.isArray(body) && body[0] ? normalizeToken(body[0]) : null;
    underlyingCache.set(t.underlyingId, u);
    return u;
  } catch {
    return null;
  }
}

/** Each chain's dollar stablecoin to sell into: a verified USDC (else USDT) at its peg, from the feed itself. */
function sellTargets(list: MerklOpportunity[]): Map<number, string> {
  const rank = (sym: string) => ['USDC', 'USDT0', 'USDT', 'USDC.E'].indexOf(sym.toUpperCase());
  const best = new Map<number, MerklToken>();
  for (const t of list.flatMap((o) => [...o.tokens, ...o.campaigns.map((c) => c.rewardToken)])) {
    if (!t.verified || t.price === null || Math.abs(t.price - 1) > 0.02 || rank(t.symbol) < 0 || !/^0x[0-9a-fA-F]{40}$/.test(t.address)) continue;
    const b = best.get(t.chainId);
    if (!b || rank(t.symbol) < rank(b.symbol)) best.set(t.chainId, t);
  }
  return new Map([...best].map(([c, t]) => [c, t.address]));
}

/** Raw integer amount for `usd` worth of a token, without floating-point overflow. */
function rawAmount(usd: number, price: number, decimals: number): string | null {
  const units = usd / price;
  if (!(units > 0) || !Number.isFinite(units)) return null;
  const head = Math.min(decimals, 6);
  return (BigInt(Math.max(1, Math.round(units * 10 ** head))) * BigInt(10) ** BigInt(decimals - head)).toString();
}

/** One sale quote; null when KyberSwap knows no route (token or route not found); undefined when it could not be asked. */
async function quoteSale(chainId: number, t: MerklToken, target: string, via: string | null): Promise<SellQuote | null | undefined> {
  if (t.price === null || t.decimals == null) return undefined;
  const amount = rawAmount(SELL_TEST_USD, t.price, t.decimals);
  if (!amount) return undefined;
  const url = `${KYBER}/${KYBER_CHAINS[chainId]}/api/v1/routes?tokenIn=${t.address}&tokenOut=${target}&amountIn=${amount}`;
  // KyberSwap rate-limits bursts (429): back off and ask again a few times.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json', 'x-client-id': 'yieldx' }, cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1_500 * (attempt + 1)));
        continue;
      }
      const body = (await res.json()) as { code?: number; data?: { routeSummary?: { amountOutUsd?: string } } };
      // 4008 route not found, 4011 token not found: nothing to sell into.
      if (body.code === 4008 || body.code === 4011) return null;
      const outUsd = Number(body.data?.routeSummary?.amountOutUsd);
      if (body.code !== 0 || !(outUsd >= 0)) return undefined;
      // What the sale realises of Merkl's own valuation: price impact and any price gap together.
      return { keptPct: (outUsd / SELL_TEST_USD) * 100, usdPerToken: outUsd / (SELL_TEST_USD / t.price), via, source: 'KyberSwap' };
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** Sell quotes for every priced reward token that is not a verified stable or major. */
export async function fetchSells(list: MerklOpportunity[]): Promise<Record<string, SellQuote | null>> {
  const targets = sellTargets(list);
  const tokens = new Map<string, MerklToken>();
  for (const o of list)
    for (const c of o.campaigns) {
      const t = c.rewardToken;
      if (t.type === 'TOKEN' && t.price !== null && !(t.verified && tokenClass(t) !== 'other') && KYBER_CHAINS[t.chainId] && /^0x[0-9a-fA-F]{40}$/.test(t.address)) tokens.set(tokenKey(t.chainId, t.address), t);
    }
  const now = Date.now();
  const out: Record<string, SellQuote | null> = {};
  const ask = async (key: string, t: MerklToken) => {
    const u = await underlyingOf(t);
    const sold = u && u.chainId === t.chainId ? u : t;
    const target = targets.get(t.chainId);
    if (!target) return undefined;
    // It turns into the very stablecoin we would sell into: nothing to swap.
    if (sold.address.toLowerCase() === target.toLowerCase() && t.price !== null) return { keptPct: 100, usdPerToken: t.price, via: sold.symbol, source: 'KyberSwap' as const };
    const q = await quoteSale(t.chainId, sold, target, sold === t ? null : sold.symbol);
    if (q !== undefined) sellCache.set(key, { q, at: Date.now() });
    return q;
  };
  const cold: [string, MerklToken][] = [];
  for (const [key, t] of tokens) {
    const hit = sellCache.get(key);
    if (hit && now - hit.at < SELL_KEEP_MS) {
      // Serve the last answer; past its TTL, ask again behind it so the feed never waits.
      out[key] = hit.q;
      if (now - hit.at >= SELL_TTL_MS && !refreshing.has(key)) {
        refreshing.add(key);
        void ask(key, t).finally(() => refreshing.delete(key));
      }
    } else cold.push([key, t]);
  }
  await mapLimit(cold, 3, async ([key, t]) => {
    const q = await ask(key, t);
    // A call that failed is not «unsellable»: the token stays unchecked.
    if (q !== undefined) out[key] = q;
  });
  return out;
}

// ─── Gas ─────────────────────────────────────────────────────────────────────

async function fetchGas(list: MerklOpportunity[]): Promise<GasQuote[]> {
  const eth = list.flatMap((o) => o.tokens).find((t) => t.chainId === 1 && t.verified && /^w?eth$/i.test(t.symbol) && t.price !== null)?.price;
  if (!eth) return [];
  try {
    const res = await fetch(ETH_RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }),
      next: { revalidate: REVALIDATE_S, tags: ['gas'] },
      signal: AbortSignal.timeout(8_000),
    } as RequestInit);
    const body = (await res.json()) as { result?: string };
    const wei = body.result ? Number(BigInt(body.result)) : NaN;
    if (!(wei > 0)) return [];
    return [{ chainId: 1, gwei: wei / 1e9, nativeUsd: eth, at: Date.now() }];
  } catch {
    return [];
  }
}

// ─── Feed ────────────────────────────────────────────────────────────────────

/** Last good feed in this server instance: served, flagged stale, when a refresh fails. */
let lastGood: Omit<MerklFeed, 'stale'> | null = null;

export async function getMerklFeed(): Promise<MerklFeed> {
  try {
    const [fresh, programs] = await Promise.all([fetchLive(), fetchPrograms()]);
    if (!fresh.opportunities.length && lastGood) return { ...lastGood, stale: true };
    const [markets, gas, sells] = await Promise.all([fetchMarkets(fresh.opportunities), fetchGas(fresh.opportunities), fetchSells(fresh.opportunities)]);
    lastGood = { ...fresh, programs, markets, marketChains: Object.keys(DEX_CHAINS).map(Number), sells, gas };
    return { ...lastGood, stale: false };
  } catch (error) {
    if (lastGood) return { ...lastGood, stale: true };
    throw error;
  }
}
