import protocols from '../../config/protocols.json';
import type { Opportunity } from '../../types/opportunity';
import { fetchJson, isArrayOf } from '../protocols/base';

/**
 * Pendle's own PT-looping list (app.pendle.finance/trade/pt-looping), from its public API
 * GET /v1/pt-looping/loop/boxes — one «box» per PT and money market that lends against it.
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
  data?: {
    lltv?: number;
    borrowApy?: number;
    borrowApy7dAvg?: number;
    liquidityUsd?: number;
    totalSupplyUsd?: number;
    utilization?: number;
    borrowRateCurve?: { utilization: number; borrowApy: number }[];
  } | null;
}

/** Money markets with their own source in YieldX: their boxes would only repeat them. */
const OWN_SOURCE = new Set(['morpho']);

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isAddr = (x: unknown): x is string => typeof x === 'string' && /^0x[0-9a-fA-F]{40}$/.test(x);

export function pendleLoopLender(b: PendleLoopBox, fetchedAt: string): Opportunity | null {
  const d = b.data ?? {};
  if (b.kind !== 'pt' || OWN_SOURCE.has(b.protocol?.toLowerCase()) || b.isDepegged) return null;
  if (!isAddr(b.ptAddress) || !isAddr(b.debtAsset) || !isAddr(b.moneyMarketAddress) || !b.debtSymbol || !b.ptSymbol) return null;
  if (!fin(d.lltv) || !(d.lltv > 0 && d.lltv < 1) || !fin(d.borrowApy) || d.borrowApy < 0 || d.borrowApy > 2) return null;
  const chain = `eip155:${b.chainId}`;
  const supplied = fin(d.totalSupplyUsd) ? d.totalSupplyUsd : null;
  const points = (d.borrowRateCurve ?? []).filter((p) => fin(p.utilization) && fin(p.borrowApy)).map((p) => ({ u: p.utilization, rate: p.borrowApy * 100 })).sort((a, b) => a.u - b.u);
  const curve = supplied !== null && fin(d.utilization) && points.length >= 2 ? { suppliedUsd: supplied, borrowedUsd: supplied * d.utilization, points, source: 'Pendle PT looping' } : null;
  const link = b.marketUrl?.startsWith('https://') ? b.marketUrl : b.url?.startsWith('https://') ? b.url : 'https://app.pendle.finance/trade/pt-looping';
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
      collateral: [{ token: { symbol: b.ptSymbol, address: b.ptAddress.toLowerCase() }, maxLtv: d.lltv, yield: null }],
      metric: 'hf',
    },
    quality: 'partial',
    sources: [{ name: 'Pendle PT looping', url: `${protocols.pendle.apiBase}/v1/pt-looping/loop/boxes`, fetchedAt, sourceUpdatedAt: null }],
    notes: [`بازار وام ${b.protocol} از فهرست PT Looping خود Pendle؛ نرخ وام و LLTV همان است که Pendle نشان می‌دهد (طرح API مستند نیست).`],
    url: link,
    icon: null,
  };
}

export async function fetchPendleLoops(fetchedAt: string): Promise<Opportunity[]> {
  const boxes = await fetchJson<PendleLoopBox[]>('Pendle PT looping', `${protocols.pendle.apiBase}/v1/pt-looping/loop/boxes`, isArrayOf<PendleLoopBox>);
  // One lender per money market, PT and debt (a PT can sit in several boxes of one market).
  const seen = new Map<string, Opportunity>();
  for (const b of boxes) {
    const o = pendleLoopLender(b, fetchedAt);
    if (o && !seen.has(o.key)) seen.set(o.key, o);
  }
  return [...seen.values()];
}
