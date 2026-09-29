import type { AirdropClaim, AirdropProgram, AirdropSale } from '../../types/airdrop';
import { normalizeSearch } from '../utils/formatting';

/**
 * Points → airdrop accounting. Airdrop tokens have a zero cost basis: their cost is
 * the YT's cash result, already in the position's P&L, so it is never counted twice.
 * Unknown prices stay unknown (null), never 0.
 */
export type AirdropStage = 'collecting' | 'pending' | 'received' | 'selling' | 'closed' | 'none';

const EPS = 1e-9;

export interface AirdropSummary {
  stage: AirdropStage;
  finalPoints: number | null;
  received: number;
  /** Still locked at `now`. */
  locked: number;
  nextUnlock: string | null;
  sold: number;
  remaining: number;
  /** USD value of the tokens on the claim date(s); null if a rate is missing. */
  claimValueUsd: number | null;
  /** Sale proceeds − sale fees − claim fees. */
  realizedUsd: number | null;
  /** Remaining tokens × current price; null without a price. */
  unrealizedUsd: number | null;
  /** realized + unrealized (null when either part is unknown). */
  totalUsd: number | null;
  /** Actual USD value of 1M points at claim: the calibration for the next season. */
  valuePerMillion: number | null;
  /** Average sale price per token, USD. */
  avgSaleUsd: number | null;
}

const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);

function knownSum<T>(xs: T[], f: (x: T) => number | null): number | null {
  let s = 0;
  for (const x of xs) {
    const v = f(x);
    if (v === null || !Number.isFinite(v)) return null;
    s += v;
  }
  return s;
}

export function stageOf(p: AirdropProgram): AirdropStage {
  if (p.noAirdrop) return 'none';
  const received = sum(p.claims, (c) => c.amount);
  if (received <= EPS) return p.finalPoints ? 'pending' : 'collecting';
  const sold = sum(p.sales, (s) => s.amount);
  if (sold >= received - EPS) return 'closed';
  return p.sales.length ? 'selling' : 'received';
}

/** `price`: current USD per token (automatic or manual); null when unknown. */
export function summarize(p: AirdropProgram, price: number | null, now = Date.now()): AirdropSummary {
  const stage = stageOf(p);
  const received = sum(p.claims, (c) => c.amount);
  const sold = sum(p.sales, (s) => s.amount);
  const remaining = Math.max(0, received - sold);
  const lockedClaims = p.claims.filter((c) => c.lockedAmount > EPS && c.unlockAt && new Date(c.unlockAt).getTime() > now);
  const locked = sum(lockedClaims, (c) => c.lockedAmount);
  const nextUnlock = lockedClaims.map((c) => c.unlockAt as string).sort()[0] ?? null;
  const claimValueUsd = p.claims.length ? knownSum(p.claims, (c) => (c.usdRate === null ? null : c.amount * c.usdRate)) : null;
  const proceeds = knownSum(p.sales, (s) => (s.received.usdRate === null ? null : s.received.amount * s.received.usdRate));
  const fees = sum(p.sales, (s) => s.feeUsd) + sum(p.claims, (c) => c.feeUsd);
  const realizedUsd = proceeds === null ? null : proceeds - fees;
  const unrealizedUsd = remaining <= EPS ? 0 : price !== null && Number.isFinite(price) ? remaining * price : null;
  const none = stage === 'none' || stage === 'collecting' || stage === 'pending';
  const totalUsd = none ? (stage === 'none' ? 0 : null) : realizedUsd === null || unrealizedUsd === null ? null : realizedUsd + unrealizedUsd;
  const points = p.finalPoints?.amount ?? null;
  return {
    stage,
    finalPoints: points,
    received,
    locked,
    nextUnlock,
    sold,
    remaining,
    claimValueUsd,
    realizedUsd: p.sales.length || p.claims.length ? realizedUsd : null,
    unrealizedUsd: received > EPS ? unrealizedUsd : null,
    totalUsd,
    valuePerMillion: points && points > 0 && claimValueUsd !== null ? claimValueUsd / (points / 1e6) : null,
    avgSaleUsd: sold > EPS && proceeds !== null ? proceeds / sold : null,
  };
}

/**
 * Share of each linked position: the manual split when set (normalised), otherwise
 * pro rata by the points each position is estimated to have earned; equal when
 * no estimate exists.
 */
export function shares(p: AirdropProgram, estimatedPoints: Record<string, number>): Record<string, number> {
  const ids = p.positionIds;
  if (!ids.length) return {};
  const weight = (id: string) => {
    const w = p.shares ? p.shares[id] : estimatedPoints[id];
    return w !== undefined && Number.isFinite(w) && w > 0 ? w : 0;
  };
  const total = ids.reduce((s, id) => s + weight(id), 0);
  return Object.fromEntries(ids.map((id) => [id, total > 0 ? weight(id) / total : 1 / ids.length]));
}

/** Programs are matched by name only for suggestions — case, spacing and Arabic letters ignored. */
export const programKey = (name: string) => normalizeSearch(name).replace(/\s+/g, '');

/**
 * Actual value of 1M points from earlier seasons of the same program — the best
 * estimate for the next season. Latest season first.
 */
export function pastValues(programs: AirdropProgram[], name: string, excludeId?: string): { season: number | null; valuePerMillion: number; at: string }[] {
  const key = programKey(name);
  if (!key) return [];
  return programs
    .filter((p) => p.id !== excludeId && programKey(p.name) === key)
    .map((p) => ({ p, s: summarize(p, null) }))
    .filter(({ s }) => s.valuePerMillion !== null)
    .map(({ p, s }) => ({ season: p.season, valuePerMillion: s.valuePerMillion as number, at: p.claims[0]?.at ?? p.updatedAt }))
    .sort((a, b) => (b.season ?? -1) - (a.season ?? -1) || b.at.localeCompare(a.at));
}

// ─── Storage / backup validation ─────────────────────────────────────────────

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isDate = (x: unknown): x is string => isStr(x) && Number.isFinite(new Date(x).getTime());

function claim(x: unknown): AirdropClaim | null {
  if (!isObj(x) || !isStr(x.id) || !isDate(x.at) || !isNum(x.amount) || x.amount < 0) return null;
  return {
    id: x.id,
    at: x.at,
    amount: x.amount,
    usdRate: isNum(x.usdRate) && x.usdRate > 0 ? x.usdRate : null,
    feeUsd: isNum(x.feeUsd) && x.feeUsd >= 0 ? x.feeUsd : 0,
    lockedAmount: isNum(x.lockedAmount) && x.lockedAmount >= 0 ? Math.min(x.lockedAmount, x.amount) : 0,
    unlockAt: isDate(x.unlockAt) ? x.unlockAt : null,
  };
}

function sale(x: unknown): AirdropSale | null {
  if (!isObj(x) || !isStr(x.id) || !isDate(x.at) || !isNum(x.amount) || x.amount < 0 || !isObj(x.received)) return null;
  const r = x.received;
  if (!isNum(r.amount) || !isStr(r.token)) return null;
  return {
    id: x.id,
    at: x.at,
    amount: x.amount,
    received: { amount: r.amount, token: r.token, usdRate: isNum(r.usdRate) && r.usdRate > 0 ? r.usdRate : null, rateSource: (['market', 'historical', 'manual', 'unknown'] as const).find((s) => s === r.rateSource) ?? 'unknown' },
    feeUsd: isNum(x.feeUsd) && x.feeUsd >= 0 ? x.feeUsd : 0,
  };
}

/** Accepts a stored/imported program; null when it isn't one. */
export function normalizeProgram(x: unknown): AirdropProgram | null {
  if (!isObj(x) || !isStr(x.id) || !isStr(x.name)) return null;
  const claims = Array.isArray(x.claims) ? x.claims.map(claim) : [];
  const sales = Array.isArray(x.sales) ? x.sales.map(sale) : [];
  if (claims.some((c) => c === null) || sales.some((s) => s === null)) return null;
  const t = isObj(x.token) && isStr(x.token.symbol) ? x.token : null;
  const fp = isObj(x.finalPoints) && isNum(x.finalPoints.amount) && isDate(x.finalPoints.at) ? x.finalPoints : null;
  const mp = isObj(x.manualPrice) && isNum(x.manualPrice.usd) && isDate(x.manualPrice.at) ? x.manualPrice : null;
  const sh = isObj(x.shares) ? Object.fromEntries(Object.entries(x.shares).filter(([, v]) => isNum(v) && v >= 0)) as Record<string, number> : null;
  return {
    id: x.id,
    name: x.name,
    season: isNum(x.season) ? x.season : null,
    positionIds: Array.isArray(x.positionIds) ? x.positionIds.filter(isStr) : [],
    shares: sh && Object.keys(sh).length ? sh : null,
    finalPoints: fp ? { amount: fp.amount as number, at: fp.at as string } : null,
    token: t ? { symbol: t.symbol as string, chain: isStr(t.chain) ? t.chain : '', address: isStr(t.address) && t.address.trim() ? t.address.trim() : null } : null,
    claims: claims as AirdropClaim[],
    sales: sales as AirdropSale[],
    noAirdrop: x.noAirdrop === true,
    manualPrice: mp ? { usd: mp.usd as number, at: mp.at as string } : null,
    createdAt: isDate(x.createdAt) ? x.createdAt : new Date().toISOString(),
    updatedAt: isDate(x.updatedAt) ? x.updatedAt : new Date().toISOString(),
  };
}

export const emptyProgram = (id: string, name: string, season: number | null, positionId: string): AirdropProgram => {
  const now = new Date().toISOString();
  return { id, name: name.trim(), season, positionIds: [positionId], shares: null, finalPoints: null, token: null, claims: [], sales: [], noAirdrop: false, manualPrice: null, createdAt: now, updatedAt: now };
};
