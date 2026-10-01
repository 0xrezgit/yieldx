import lending from '../../config/lending.json';
import type { BookLevel, Opportunity, OrderBook } from '../../types/opportunity';
import { networkByChainId } from '../registry/networks';
import { UpstreamError, fetchJson, isObject, mapLimit, postGraphql } from '../protocols/base';
import { HORIZONS } from '../opportunity/policy';
import { formatPercent } from '../utils/formatting';

/**
 * Morpho Midnight — fixed-rate lending on an onchain order book. The lender buys
 * credit units from `asks`; each unit redeems one loan token at maturity.
 *
 * API and meanings from the official SDK (@morpho-org/midnight-sdk 1.8.0,
 * lib/esm/api): base `https://api.morpho.org/v0/midnight`; `GET /books` (filters
 * as comma-joined query values), `GET /books/{marketId}/{asks|bids}?depth=`.
 * Price levels: `price` WAD-scaled (1e18 = 1), `units` / `assets` in raw
 * loan-token amounts. «Book asks are maker sell offers, bids maker buy offers.»
 * A buyer pays `price + settlementFee` per unit, a seller receives `price − fee`.
 *
 * The settlement fee and continuous fee are per-market onchain state that the
 * API does not return. Without an RPC read they are taken at the protocol's
 * maximum (SDK constants MAX_SETTLEMENT_FEES by SETTLEMENT_FEE_BREAKPOINTS, and
 * MAX_CONTINUOUS_FEE = 317097919 WAD per second ≈ 1% a year) — the estimate is
 * therefore conservative and says so.
 */

const CFG = lending.midnight;
const WAD = 1e18;
const ZERO = '0x0000000000000000000000000000000000000000';
const isAddress = (a: unknown): a is string => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);

/** SDK SETTLEMENT_FEE_BREAKPOINTS (seconds) and MAX_SETTLEMENT_FEES (WAD). */
export const MIDNIGHT_FEE_BREAKPOINTS_SEC = [0, 1, 7, 30, 90, 180, 360].map((d) => d * 86_400);
export const MIDNIGHT_MAX_SETTLEMENT_FEES = [14e12, 14e12, 98e12, 417e12, 1250e12, 2500e12, 5000e12].map((x) => x / WAD);
/** SDK MAX_CONTINUOUS_FEE per second × seconds in a 365-day year. */
export const MIDNIGHT_MAX_CONTINUOUS_FEE_YEAR = (317097919 * 31_536_000) / WAD;

export interface RawLevel {
  tick: number;
  price: string;
  units: string;
  assets: string;
  count: number;
}
export interface RawBook {
  market_id: string;
  chain_id: number;
  midnight: string;
  loan_token: string;
  collaterals: { token: string; lltv: string; liquidation_cursor: string; oracle: string }[];
  maturity: number;
  rcf_threshold: string;
  enter_gate: string;
  liquidator_gate: string;
  asks: RawLevel[];
  bids: RawLevel[];
}
export interface TokenInfo {
  symbol: string;
  decimals: number;
  priceUsd: number | null;
  logoURI: string | null;
}

const isBooks = (b: unknown): b is { data: RawBook[]; cursor?: string | null } => isObject<{ data: unknown }>(b) && Array.isArray(b.data);
const isLevels = (b: unknown): b is { data: RawLevel[] } => isObject<{ data: unknown }>(b) && Array.isArray(b.data);

function levels(raw: RawLevel[], decimals: number): BookLevel[] {
  return raw
    .map((l) => ({ price: Number(l.price) / WAD, units: Number(l.units) / 10 ** decimals }))
    .filter((l) => Number.isFinite(l.price) && l.price > 0 && l.price <= 1 && Number.isFinite(l.units) && l.units > 0);
}

/** One Midnight book in the shared model; null when the loan token cannot be priced or identified. */
export function midnightOpportunity(b: RawBook, tokens: Map<string, TokenInfo>, fetchedAt: string, depth?: { asks: RawLevel[]; bids: RawLevel[] }): Opportunity | null {
  if (!isAddress(b.loan_token) || !b.market_id || !Number.isFinite(b.maturity) || !b.chain_id) return null;
  const network = networkByChainId(b.chain_id);
  const loan = tokens.get(`${b.chain_id}:${b.loan_token.toLowerCase()}`);
  const collSymbols = (b.collaterals ?? []).map((c) => tokens.get(`${b.chain_id}:${c.token?.toLowerCase()}`)?.symbol ?? '—');
  const maturity = new Date(b.maturity * 1000).toISOString();
  const decimals = loan?.decimals;
  const book: OrderBook | null =
    loan && decimals !== undefined && Number.isInteger(decimals)
      ? {
          asks: levels(depth?.asks ?? b.asks ?? [], decimals),
          bids: levels(depth?.bids ?? b.bids ?? [], decimals),
          unitUsd: loan.priceUsd ?? NaN,
          loanSymbol: loan.symbol,
          settlementFee: { breakpointsSec: MIDNIGHT_FEE_BREAKPOINTS_SEC, values: MIDNIGHT_MAX_SETTLEMENT_FEES, basis: 'max' },
          continuousFeePerYear: { value: MIDNIGHT_MAX_CONTINUOUS_FEE_YEAR, basis: 'max' },
          gated: isAddress(b.enter_gate) && b.enter_gate !== ZERO,
        }
      : null;
  const lltvs = (b.collaterals ?? []).map((c) => Number(c.lltv) / WAD).filter((x) => x > 0 && x < 1);
  return {
    key: `morpho:${network.key}:${b.market_id.toLowerCase()}:fixed`,
    family: 'fixed-lend',
    protocol: { id: 'morpho', version: 'midnight', name: 'Morpho Midnight' },
    chain: network.key,
    market: { id: b.market_id, address: null, name: `${loan?.symbol ?? '—'} · وثیقه ${collSymbols.join('، ') || '—'}` },
    assets: {
      deposit: [{ symbol: loan?.symbol ?? null, address: b.loan_token }],
      collateral: (b.collaterals ?? []).map((c) => ({ symbol: tokens.get(`${b.chain_id}:${c.token?.toLowerCase()}`)?.symbol ?? null, address: c.token ?? null })),
    },
    rate: { value: null, kind: 'quote', feesIncluded: true, rewardsIncluded: false, at: null },
    maturity,
    capacity: { depositRemainingUsd: null, withdrawableNowUsd: null },
    exit: { type: 'maturity', note: 'نگه‌داری تا سررسید و بازخرید ۱ به ۱ توکن وام؛ خروج زودتر فقط با فروش واحدها در دفتر خرید، اگر خریدار باشد.' },
    rewards: [],
    book,
    // Borrowing here means selling units into the bids at a fixed price until maturity.
    borrow: book
      ? {
          ratePct: null,
          curve: null,
          availableUsd: book.unitUsd > 0 ? book.bids.reduce((a, l) => a + l.units * l.price, 0) * book.unitUsd : null,
          collateral: (b.collaterals ?? [])
            .map((c) => ({ token: { symbol: tokens.get(`${b.chain_id}:${c.token?.toLowerCase()}`)?.symbol ?? null, address: c.token ?? null }, maxLtv: Number(c.lltv) / WAD }))
            .filter((c) => c.maxLtv > 0 && c.maxLtv < 1),
          metric: 'ltv',
        }
      : null,
    risk: { oracle: null, curator: null, paused: false, incidents: [] },
    quality: book === null ? 'insufficient' : !(book.unitUsd > 0) ? 'insufficient' : 'current',
    sources: [{ name: 'Morpho Midnight API', url: CFG.api, fetchedAt, sourceUpdatedAt: null }],
    notes: [
      ...(lltvs.length ? [`حداکثر نسبت وام به وثیقه‌ی وام‌گیرندگان (LLTV): ${lltvs.map((x) => formatPercent(x * 100, 1)).join('، ')}.`] : []),
      ...(book === null ? ['اطلاعات توکن وام (نماد، اعشار یا قیمت) دریافت نشد.'] : []),
    ],
    url: CFG.app,
    icon: loan?.logoURI ?? null,
  };
}

// ─── Fetch ───────────────────────────────────────────────────────────────────

// One list query per chain: `assetByAddress` for several tokens fails as a whole when any
// one is unknown to Morpho (data: null), while a filtered list simply leaves it out.
const ASSETS_QUERY = `query YieldXMidnightTokens($chain: Int!, $addresses: [String!]!, $first: Int!) {
  assets(first: $first, where: { chainId_in: [$chain], address_in: $addresses }) {
    items { address symbol decimals logoURI price { usd } }
  }
}`;

interface RawAssetItem {
  address: string;
  symbol?: string;
  decimals?: number;
  logoURI?: string | null;
  price?: { usd?: number | null } | null;
}

/** Symbol, decimals and USD price for each (chain, token) pair, from Morpho's API; missing ones are simply absent. */
export async function fetchTokens(pairs: { chainId: number; address: string }[]): Promise<Map<string, TokenInfo>> {
  const byChain = new Map<number, Set<string>>();
  for (const p of pairs) if (isAddress(p.address)) byChain.set(p.chainId, (byChain.get(p.chainId) ?? new Set()).add(p.address.toLowerCase()));
  const out = new Map<string, TokenInfo>();
  await Promise.all(
    [...byChain].map(async ([chainId, set]) => {
      const addresses = [...set].slice(0, CFG.maxTokens);
      try {
        const d = await postGraphql(lending.morpho.name, lending.morpho.graphql, ASSETS_QUERY, { chain: chainId, addresses, first: addresses.length }, (b): b is { assets: { items: RawAssetItem[] } } => isObject(b) && isObject((b as { assets?: unknown }).assets));
        for (const t of d.assets.items ?? []) {
          if (!isAddress(t.address) || typeof t.symbol !== 'string' || typeof t.decimals !== 'number') continue;
          const usd = t.price?.usd;
          out.set(`${chainId}:${t.address.toLowerCase()}`, { symbol: t.symbol, decimals: t.decimals, priceUsd: typeof usd === 'number' && usd > 0 ? usd : null, logoURI: t.logoURI ?? null });
        }
      } catch {
        /* this chain's tokens stay unknown: its books are marked insufficient */
      }
    }),
  );
  return out;
}

/** One chain's books, nearest maturity first, until maturities pass the longest horizon (they cannot be ranked). */
async function listBooks(chainId: number, now: number): Promise<RawBook[]> {
  const until = now / 1000 + Math.max(...HORIZONS) * 86_400;
  const out: RawBook[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < CFG.maxPages; page++) {
    const q = new URLSearchParams({ chain_ids: String(chainId), limit: String(CFG.pageSize), sort: 'maturity' });
    if (cursor) q.set('cursor', cursor);
    const d = await fetchJson(CFG.name, `${CFG.api}/books?${q}`, isBooks);
    out.push(...d.data);
    cursor = d.cursor ?? null;
    if (!cursor || !d.data.length || d.data[d.data.length - 1].maturity > until) break;
  }
  return out.filter((b) => b.maturity <= until);
}

export async function fetchMidnight(fetchedAt: string, now = Date.now()): Promise<Opportunity[]> {
  // The API takes one chain per request and at most 20 books per page (seen 2026-10-01).
  const lists = await Promise.all(CFG.chains.map((c) => listBooks(c, now)));
  // A book with no quote on either side can neither lend nor borrow: no row for it.
  const live = lists.flat().filter((b) => b?.market_id && b.maturity * 1000 > now && ((b.asks?.length ?? 0) > 0 || (b.bids?.length ?? 0) > 0));
  // Full depth per side: the list only carries the top levels.
  const side = async (b: RawBook, s: 'asks' | 'bids') => {
    try {
      return (await fetchJson(CFG.name, `${CFG.api}/books/${encodeURIComponent(b.market_id)}/${s}?depth=${CFG.depth}`, isLevels)).data;
    } catch (e) {
      if (e instanceof UpstreamError) return null;
      throw e;
    }
  };
  const depth = (
    await mapLimit(live, CFG.concurrency, async (b) => {
      const [asks, bids] = await Promise.all([side(b, 'asks'), side(b, 'bids')]);
      return asks && bids ? { asks, bids } : undefined;
    })
  ).map((r) => (r.status === 'fulfilled' ? r.value : undefined));
  const tokens = await fetchTokens(live.flatMap((b) => [{ chainId: b.chain_id, address: b.loan_token }, ...(b.collaterals ?? []).map((c) => ({ chainId: b.chain_id, address: c.token }))]));
  return live.map((b, i) => midnightOpportunity(b, tokens, fetchedAt, depth[i])).filter((o): o is Opportunity => o !== null);
}
