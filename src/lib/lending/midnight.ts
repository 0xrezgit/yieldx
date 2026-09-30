import lending from '../../config/lending.json';
import type { BookLevel, Opportunity, OrderBook } from '../../types/opportunity';
import { networkByChainId } from '../registry/networks';
import { UpstreamError, fetchJson, isObject, postGraphql } from '../protocols/base';
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

const isBooks = (b: unknown): b is { data: RawBook[]; cursor: string | null } => isObject<{ data: unknown }>(b) && Array.isArray(b.data);
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

const ASSET_QUERY = (n: number) =>
  `query YieldXMidnightTokens(${Array.from({ length: n }, (_, i) => `$a${i}: String!, $c${i}: Int`).join(', ')}) {\n${Array.from({ length: n }, (_, i) => `  t${i}: assetByAddress(address: $a${i}, chainId: $c${i}) { address symbol decimals priceUsd logoURI }`).join('\n')}\n}`;

/** Symbol, decimals and USD price for each (chain, token) pair, from Morpho's API; missing ones are simply absent. */
export async function fetchTokens(pairs: { chainId: number; address: string }[]): Promise<Map<string, TokenInfo>> {
  const unique = [...new Map(pairs.filter((p) => isAddress(p.address)).map((p) => [`${p.chainId}:${p.address.toLowerCase()}`, p])).values()].slice(0, CFG.maxTokens);
  const out = new Map<string, TokenInfo>();
  if (!unique.length) return out;
  const vars: Record<string, unknown> = {};
  unique.forEach((p, i) => {
    vars[`a${i}`] = p.address;
    vars[`c${i}`] = p.chainId;
  });
  // Unknown tokens make assetByAddress error; keep whatever resolved.
  let data: Record<string, { symbol?: string; decimals?: number; priceUsd?: number | null; logoURI?: string | null } | null>;
  try {
    data = await postGraphql(lending.morpho.name, lending.morpho.graphql, ASSET_QUERY(unique.length), vars, (b): b is typeof data => isObject(b));
  } catch {
    return out;
  }
  unique.forEach((p, i) => {
    const t = data[`t${i}`];
    if (t && typeof t.symbol === 'string' && typeof t.decimals === 'number') {
      out.set(`${p.chainId}:${p.address.toLowerCase()}`, { symbol: t.symbol, decimals: t.decimals, priceUsd: typeof t.priceUsd === 'number' && t.priceUsd > 0 ? t.priceUsd : null, logoURI: t.logoURI ?? null });
    }
  });
  return out;
}

export async function fetchMidnight(fetchedAt: string, now = Date.now()): Promise<Opportunity[]> {
  const q = new URLSearchParams({ chain_ids: CFG.chains.join(','), limit: String(CFG.maxBooks), sort: 'maturity' });
  const { data } = await fetchJson(CFG.name, `${CFG.api}/books?${q}`, isBooks);
  const live = data.filter((b) => b?.market_id && b.maturity * 1000 > now);
  // Full depth per side: the list only carries the top levels.
  const depth = await Promise.all(
    live.map(async (b) => {
      const side = async (s: 'asks' | 'bids') => {
        try {
          return (await fetchJson(CFG.name, `${CFG.api}/books/${encodeURIComponent(b.market_id)}/${s}?depth=${CFG.depth}`, isLevels)).data;
        } catch (e) {
          if (e instanceof UpstreamError) return null;
          throw e;
        }
      };
      const [asks, bids] = await Promise.all([side('asks'), side('bids')]);
      return asks && bids ? { asks, bids } : undefined;
    }),
  );
  const tokens = await fetchTokens(live.flatMap((b) => [{ chainId: b.chain_id, address: b.loan_token }, ...(b.collaterals ?? []).map((c) => ({ chainId: b.chain_id, address: c.token }))]));
  return live.map((b, i) => midnightOpportunity(b, tokens, fetchedAt, depth[i])).filter((o): o is Opportunity => o !== null);
}
