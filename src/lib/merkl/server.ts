import 'server-only';
import { normalizeOpportunity, normalizeProgram, type RawOpportunity, type RawProgram } from './normalize';
import { DEX_CHAINS, marketFromPairs, type RawPair } from './markets';
import { dedupe, isMeme, isRobinhoodChain, tokenClass } from './vetting';
import { tokenKey, type GasQuote, type MerklFeed, type MerklOpportunity, type MerklProgram, type MerklToken, type TokenMarket } from './types';

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
    const [markets, gas] = await Promise.all([fetchMarkets(fresh.opportunities), fetchGas(fresh.opportunities)]);
    lastGood = { ...fresh, programs, markets, marketChains: Object.keys(DEX_CHAINS).map(Number), gas };
    return { ...lastGood, stale: false };
  } catch (error) {
    if (lastGood) return { ...lastGood, stale: true };
    throw error;
  }
}
