import protocols from '../../config/protocols.json';
import type { Opportunity } from '../../types/opportunity';
import { fetchJson, isArrayOf } from '../protocols/base';
import { pendleLoopLink } from '../market/links';

/**
 * Pendle's own loop list (PendleLoop, app.pendle.finance/trade/loop), from its public API
 * GET /v1/pt-looping/loop/boxes (the path still says pt-looping) — one «box» per collateral and money market that lends
 * against it: a PT (`kind: 'pt'`) or a yield-bearing asset without maturity such as sUSDe
 * or wstETH (`kind: 'vanilla'`, its yield as Pendle reads it). Long/short boxes (a price
 * bet, collateral and debt uncorrelated) only come with `includeLongShort=true` and are
 * not asked for: a loop here earns from yield, not price.
 *
 * Morpho boxes are not lenders here, but they mark Morpho's own markets: the same
 * collateral and debt there gets PendleLoop's page (`markPendleLoops`).
 * Used only for the money markets YieldX does not read itself (Aave V3, Euler): Morpho
 * boxes are skipped, Morpho's own source has them with more detail. Each box becomes a
 * borrow-only market that accepts that exact PT, so the PT loop board and the market
 * analysis pick it up like any other lender. Field meanings read from the live answer
 * (APYs as fractions, LLTV 0…1); the schema is not documented.
 */

export interface PendleLoopBox {
  boxId: string;
  chainId: number;
  kind: string;
  ptAddress: string;
  ptSymbol: string;
  protocol: string;
  moneyMarketAddress: string;
  moneyMarketName?: string;
  url?: string | null;
  marketUrl?: string | null;
  debtAsset: string;
  debtSymbol: string;
  isDepegged?: boolean;
  /** Long/short boxes only ('long' | 'short'). */
  side?: string | null;
  /** PT boxes: the PT's maturity (ISO); the box stays in Pendle's list for a while after it. */
  expiry?: string | null;
  data?: {
    lltv?: number;
    borrowApy?: number;
    borrowApy7dAvg?: number;
    liquidityUsd?: number;
    totalSupplyUsd?: number;
    utilization?: number;
    borrowRateCurve?: { utilization: number; borrowApy: number }[];
    /** Vanilla boxes: the collateral's own yield, as a fraction. */
    collateralYieldApy?: number | null;
    /** Vanilla boxes: what the money market pays on the collateral itself, as a fraction. */
    collateralSupplyApy?: number | null;
  } | null;
}

/** Money markets with their own source in YieldX: their boxes would only repeat them. */
const OWN_SOURCE = new Set(['morpho']);

/** The box's own page in PendleLoop (see pendleLoopLink). */
export const pendleLoopUrl = (b: Pick<PendleLoopBox, 'boxId' | 'chainId'>) => pendleLoopLink(b.chainId, b.boxId).url;

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isAddr = (x: unknown): x is string => typeof x === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x);

export function pendleLoopLender(b: PendleLoopBox, fetchedAt: string): Opportunity | null {
  const d = b.data ?? {};
  if ((b.kind !== 'pt' && b.kind !== 'vanilla') || b.side || OWN_SOURCE.has(b.protocol?.toLowerCase()) || b.isDepegged) return null;
  // A PT past maturity: nothing left to loop (its box lingers with broken rates).
  if (b.kind === 'pt' && typeof b.expiry === 'string' && !(Date.parse(b.expiry) > Date.parse(fetchedAt))) return null;
  if (!isAddr(b.ptAddress) || !isAddr(b.debtAsset) || !isAddr(b.moneyMarketAddress) || !b.debtSymbol || !b.ptSymbol) return null;
  if (!fin(d.lltv) || !(d.lltv > 0 && d.lltv < 1) || !fin(d.borrowApy) || d.borrowApy < 0 || d.borrowApy > 2) return null;
  const chain = `eip155:${b.chainId}`;
  const supplied = fin(d.totalSupplyUsd) ? d.totalSupplyUsd : null;
  const points = (d.borrowRateCurve ?? []).filter((p) => fin(p.utilization) && fin(p.borrowApy)).map((p) => ({ u: p.utilization, rate: p.borrowApy * 100 })).sort((a, b) => a.u - b.u);
  const curve = supplied !== null && fin(d.utilization) && points.length >= 2 ? { suppliedUsd: supplied, borrowedUsd: supplied * d.utilization, points, source: 'PendleLoop' } : null;
  // A vanilla collateral without a positive yield of its own makes no loop: nothing to multiply.
  const assetYield = b.kind === 'vanilla' ? (fin(d.collateralYieldApy) && d.collateralYieldApy > 0 && d.collateralYieldApy < 2 ? { pct: d.collateralYieldApy * 100, kind: 'apy' as const, source: 'بازده دارایی طبق PendleLoop' } : null) : null;
  if (b.kind === 'vanilla' && !assetYield) return null;
  const supplyPct = b.kind === 'vanilla' && fin(d.collateralSupplyApy) && d.collateralSupplyApy > 0 ? d.collateralSupplyApy * 100 : null;
  const link = b.marketUrl?.startsWith('https://') ? b.marketUrl : b.url?.startsWith('https://') ? b.url : 'https://app.pendle.finance/trade/loop';
  return {
    key: `pendleloop:${chain}:${b.moneyMarketAddress.toLowerCase()}:${b.ptAddress.toLowerCase()}:${b.debtAsset.toLowerCase()}:borrow`,
    family: 'borrow',
    // Aave here is V3 (YieldX's own Aave source is V4): a separate id so V4 logic never applies.
    protocol: { id: b.protocol.toLowerCase() === 'aave' ? 'aave-v3' : b.protocol.toLowerCase(), version: 'via-pendle', name: b.protocol.toLowerCase() === 'aave' ? 'Aave V3' : b.protocol },
    chain,
    market: { id: b.boxId, address: b.moneyMarketAddress, name: `${b.ptSymbol}/${b.debtSymbol} · ${b.moneyMarketName ?? b.protocol}` },
    assets: { deposit: [{ symbol: b.debtSymbol, address: b.debtAsset.toLowerCase() }], collateral: [{ symbol: b.ptSymbol, address: b.ptAddress.toLowerCase() }] },
    rate: { value: null, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: fetchedAt },
    maturity: null,
    capacity: { depositRemainingUsd: null, withdrawableNowUsd: null },
    exit: { type: 'instant' },
    rewards: [],
    borrow: {
      ratePct: d.borrowApy * 100,
      ratePct7d: fin(d.borrowApy7dAvg) ? d.borrowApy7dAvg * 100 : null,
      curve,
      availableUsd: fin(d.liquidityUsd) ? d.liquidityUsd : null,
      collateral: [{ token: { symbol: b.ptSymbol, address: b.ptAddress.toLowerCase() }, maxLtv: d.lltv, yield: assetYield, ...(supplyPct !== null ? { supplyPct } : {}), pendleLoop: pendleLoopUrl(b) }],
      metric: 'hf',
    },
    quality: 'partial',
    sources: [{ name: 'PendleLoop', url: `${protocols.pendle.apiBase}/v1/pt-looping/loop/boxes`, fetchedAt, sourceUpdatedAt: null }],
    notes: [b.kind === 'pt'
      ? `بازار وام ${b.protocol} از فهرست PendleLoop (لوپ PT)؛ نرخ وام و LLTV همان است که Pendle نشان می‌دهد (طرح API مستند نیست).`
      : `بازار وام ${b.protocol} از فهرست PendleLoop (Loop to Earn)؛ نرخ وام، LLTV و بازده ${b.ptSymbol} همان است که Pendle نشان می‌دهد (طرح API مستند نیست).`],
    url: link,
    icon: null,
  };
}

/** Morpho market (or its collateral, debt and LLTV) → PendleLoop page, from the last list read (see `markPendleLoops`). */
let morphoListed = new Map<string, string>();

const byId = (chain: string, marketId: string, collateral: string, debt: string) => `id:${chain}:${marketId}:${collateral}:${debt}`.toLowerCase();
const byPair = (chain: string, collateral: string, debt: string, lltv: number) => `pair:${chain}:${collateral}:${debt}:${lltv.toFixed(4)}`.toLowerCase();

/** A Morpho box's market id, from its market page (app.morpho.org/<network>/<kind>/<id>[/<name>]). */
const morphoMarketId = (b: PendleLoopBox) => b.marketUrl?.match(/\/(0x[0-9a-fA-F]{64})(?=[/?#]|$)/)?.[1] ?? null;

export function morphoListing(boxes: PendleLoopBox[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const b of boxes) {
    if (b.protocol?.toLowerCase() !== 'morpho' || b.side || b.isDepegged || !isAddr(b.ptAddress) || !isAddr(b.debtAsset)) continue;
    if (b.kind === 'pt' && typeof b.expiry === 'string' && !(Date.parse(b.expiry) > Date.now())) continue;
    const chain = `eip155:${b.chainId}`;
    const id = morphoMarketId(b);
    // Some boxes link a named page (…/pt-reusd-10dec2026-usdt) instead of the id: matched by collateral, debt and LLTV.
    if (id) out.set(byId(chain, id, b.ptAddress, b.debtAsset), pendleLoopUrl(b));
    else if (fin(b.data?.lltv)) out.set(byPair(chain, b.ptAddress, b.debtAsset, b.data.lltv), pendleLoopUrl(b));
  }
  return out;
}

/** Morpho markets whose collateral and debt PendleLoop also lists get its page on that collateral. */
export function markPendleLoops(opps: Opportunity[], listed: Map<string, string> = morphoListed): Opportunity[] {
  if (!listed.size) return opps;
  return opps.map((o) => {
    const debt = o.assets.deposit[0]?.address;
    if (o.protocol.id !== 'morpho' || !o.borrow || !debt) return o;
    let hit = false;
    const collateral = o.borrow.collateral.map((c) => {
      const url = c.token.address ? (listed.get(byId(o.chain, o.market.id, c.token.address, debt)) ?? listed.get(byPair(o.chain, c.token.address, debt, c.maxLtv))) : undefined;
      if (!url) return c;
      hit = true;
      return { ...c, pendleLoop: url };
    });
    return hit ? { ...o, borrow: { ...o.borrow, collateral } } : o;
  });
}

export async function fetchPendleLoops(fetchedAt: string): Promise<Opportunity[]> {
  const boxes = await fetchJson<PendleLoopBox[]>('PendleLoop', `${protocols.pendle.apiBase}/v1/pt-looping/loop/boxes`, isArrayOf<PendleLoopBox>);
  // One lender per money market, PT and debt (a PT can sit in several boxes of one market).
  const seen = new Map<string, Opportunity>();
  for (const b of boxes) {
    const o = pendleLoopLender(b, fetchedAt);
    if (o && !seen.has(o.key)) seen.set(o.key, o);
  }
  morphoListed = morphoListing(boxes);
  return [...seen.values()];
}
