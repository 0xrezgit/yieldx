import type { YieldPool } from './yields';
import type { RobustRate } from '../opportunity/robust-rate';

/**
 * YieldX's own verification of a DefiLlama pool, on-chain, the way DefiLlama's
 * «Verified» filter works (its results are only in the paid API):
 *
 * 1. The pool must be an ERC-4626 vault (`asset()`, `convertToAssets`).
 * 2. Yield: the vault's share price read on-chain at one fixed block a day
 *    (00:00 UTC), today and on past days — what holders actually earned.
 * 3. Withdrawal: the largest real holders (from the explorer) each `redeem` their
 *    whole balance in a simulated call (`eth_call` from their own address) at
 *    that same block. What came out is recorded; nothing is sent.
 */

/** `collateral`: an Aave deposit backing the holder's own loan — their situation, left out of the exit figure. */
export type ExitStatus = 'full' | 'partial' | 'blocked' | 'collateral';

export interface HolderSim {
  address: string;
  /** Explorer label (SafeProxy, ALMProxy …), if any. */
  name: string | null;
  contract: boolean;
  /** The position, in the vault's asset and in dollars. */
  value: number;
  usd: number;
  /** Share of all the vault's shares. */
  sharePct: number;
  status: ExitStatus;
  /** Paid out only with the holder simulated as a plain wallet (its contract refuses the payout token). */
  asWallet: boolean;
  /** What the simulated redeem paid out, in the asset (0 when blocked). */
  out: number;
  /** Exit cost, basis points of the position's value (only when something came out). */
  feeBps: number | null;
}

export type VerifyReject = 'address' | 'not4626' | 'young' | 'price' | 'holders' | 'duplicate' | 'error';

export interface VerifiedPool extends YieldPool {
  address: string;
  /** How the contract was read: an ERC-4626 vault, or an Aave V3 (or fork) deposit token. */
  kind: 'erc4626' | 'aave';
  /** Aave: the pool's idle cash as a share of deposits (withdrawable now); null for vaults. */
  liquidityPct: number | null;
  /** The fixed daily block and its day (unix ms, 00:00 UTC). */
  block: number;
  day: number;
  /** Yield measured from the share price, percent a year; null when the vault is younger. */
  measured: { d7: number | null; d30: number | null; d90: number | null };
  /** 0–100, from the measured yield of each step over the window (see `stability`). */
  stability: number | null;
  /** The rate ranked on, from the daily yields (see `robust-rate.ts`). */
  robust: RobustRate;
  holdersCount: number | null;
  /** Holders found in the vault's Transfer logs of this many recent days (no explorer on the chain); null when from an explorer. */
  holdersFromLogs: number | null;
  sims: HolderSim[];
  /** Of the simulated holders' money, the share that came out at once. */
  instantPct: number | null;
  /** Share of all the vault's shares the simulated holders hold. */
  coveredPct: number;
}

/**
 * A measured yield above this (percent a year) is a share-price jump, not a yield: a new
 * vault priced near zero before its first deposit, a donation, an accounting reset.
 */
export const MAX_MEASURED_PCT = 500;

/** Annualised yield (percent) between two share prices `days` apart; null when absurd. */
export function annualised(from: number, to: number, days: number): number | null {
  if (!(from > 0) || !(to > 0) || !(days > 0)) return null;
  const pct = (Math.pow(to / from, 365 / days) - 1) * 100;
  return Number.isFinite(pct) && pct <= MAX_MEASURED_PCT ? pct : null;
}

/**
 * Stability score, 0–100: 100 × (1 − σ/μ) of the yields measured over each step
 * (5 days) of the window (30 days); floored at 0. A vault paying the same every step
 * scores 100; one whose yield swings by as much as its average scores 0. YieldX's
 * formula on its own measurements, not DefiLlama's.
 */
export function stability(rates: number[]): number | null {
  if (rates.length < 3) return null;
  const mean = rates.reduce((s, x) => s + x, 0) / rates.length;
  if (!(mean > 0)) return null;
  const sd = Math.sqrt(rates.reduce((s, x) => s + (x - mean) ** 2, 0) / rates.length);
  return Math.round(100 * Math.max(0, 1 - sd / mean));
}

/**
 * Share prices at day offsets (0 = today's block) → measured yields and the step
 * rates for the stability score. Missing prices (vault not deployed yet) are null.
 */
export function fromPrices(pps: Map<number, number | null>, stepDays: number, windowDays: number, longDays: number) {
  const now = pps.get(0) ?? null;
  const at = (d: number) => {
    const p = pps.get(d) ?? null;
    return now !== null && p !== null ? annualised(p, now, d) : null;
  };
  const rates: number[] = [];
  for (let d = stepDays; d <= windowDays; d += stepDays) {
    const a = pps.get(d) ?? null;
    const b = pps.get(d - stepDays) ?? null;
    const r = a !== null && b !== null ? annualised(a, b, stepDays) : null;
    if (r !== null) rates.push(r);
  }
  const measured = { d7: at(7), d30: at(windowDays), d90: at(longDays) };
  return { measured, stability: stability(rates) };
}

/**
 * Daily yields (% a year, uncapped: a jump day must stay visible to be taken out) from
 * share prices at day offsets 0…`days`, oldest first; a day without both prices is null.
 * The first `skipLaunchDays` days after the contract appeared are left out (its first
 * deposits and price set-up are not a yield).
 */
export function dailyYields(pps: Map<number, number | null>, days: number, skipLaunchDays = 2): (number | null)[] {
  let first = days;
  while (first > 0 && (pps.get(first) ?? null) === null) first--;
  const launched = first < days;
  const out: (number | null)[] = [];
  for (let d = days; d >= 1; d--) {
    const a = pps.get(d) ?? null;
    const b = pps.get(d - 1) ?? null;
    if (launched && d > first - skipLaunchDays) {
      out.push(null);
      continue;
    }
    out.push(a !== null && b !== null && a > 0 ? (Math.pow(b / a, 365) - 1) * 100 : null);
  }
  return out;
}

/** Exit summary: the share of the simulated money that came out at once (Aave loan collateral left out). */
export function instantShare(sims: HolderSim[]): number | null {
  const counted = sims.filter((h) => h.status !== 'collateral');
  const total = counted.reduce((s, h) => s + h.value, 0);
  if (!(total > 0)) return null;
  return (counted.reduce((s, h) => s + Math.min(h.out, h.value), 0) / total) * 100;
}

/** Exit cost in basis points: what the position is worth minus what came out. */
export const feeBps = (value: number, out: number) => (value > 0 && out > 0 ? Math.max(0, ((value - out) / value) * 10_000) : null);

export type ExitLabel = 'instant' | 'partial' | 'queued';

/** One word for the row: everyone out at once, part of the money, or nobody (queue / lock). */
export function exitLabel(p: Pick<VerifiedPool, 'instantPct'>): ExitLabel | null {
  if (p.instantPct === null) return null;
  if (p.instantPct >= 99.5) return 'instant';
  return p.instantPct > 0.5 ? 'partial' : 'queued';
}

/** A deposit grown by the share price between two days (the token's own price move excluded). */
export function growthFromPrices(amount: number, from: number, to: number, days: number) {
  if (!(amount > 0) || !(from > 0) || !(to > 0) || !(days > 0)) return null;
  const factor = to / from;
  return { value: amount * factor, gain: amount * (factor - 1), returnPct: (factor - 1) * 100, annualPct: (Math.pow(factor, 365 / days) - 1) * 100, days };
}

/**
 * DefiLlama can list one contract as several pools (Exactly's fixed-rate maturities on
 * its floating vault; one vault under two projects). The on-chain result belongs to the
 * contract, so one row per contract: the pool whose announced rate is nearest to the
 * measured yield, then the larger TVL. Returns the rows kept and how many were dropped.
 */
export function onePerContract(pools: VerifiedPool[]): { kept: VerifiedPool[]; dropped: VerifiedPool[] } {
  const groups = new Map<string, VerifiedPool[]>();
  for (const p of pools) {
    const key = `${p.chain}:${p.address.toLowerCase()}`;
    groups.set(key, [...(groups.get(key) ?? []), p]);
  }
  const kept: VerifiedPool[] = [];
  const dropped: VerifiedPool[] = [];
  for (const list of groups.values()) {
    const gap = (p: VerifiedPool) => {
      const m = p.robust.pct;
      const a = p.apyBase ?? p.apy;
      return m === null || a === null ? Infinity : Math.abs(m - a);
    };
    const [best, ...rest] = [...list].sort((a, b) => gap(a) - gap(b) || b.tvlUsd - a.tvlUsd);
    kept.push(best);
    dropped.push(...rest);
  }
  return { kept, dropped };
}

export interface Profit {
  /** Interest at the robust rate, compounded over the period. */
  gross: number;
  /** Exit cost seen in the simulation (median of the holders that got out), on this capital. */
  exitFee: number;
  /** Gas for approve, deposit and withdraw. */
  gas: number;
  net: number;
}

/**
 * Net dollars for `capital` over `days`, on the robust rate (daily on-chain yields, jump
 * days out, the window chosen by the pattern) — never the announced rate. The asset's own
 * price move is not included.
 */
export function profitOf(p: Pick<VerifiedPool, 'robust' | 'sims'>, capital: number, days: number, gasUsd: number): Profit | null {
  const y = p.robust.pct;
  if (y === null || !(capital > 0) || !(days > 0)) return null;
  const gross = capital * (Math.pow(1 + y / 100, days / 365) - 1);
  const fees = p.sims
    .filter((h) => h.status !== 'collateral' && h.feeBps !== null)
    .map((h) => h.feeBps as number)
    .sort((a, b) => a - b);
  const exitFee = fees.length ? (capital * fees[Math.floor(fees.length / 2)]) / 10_000 : 0;
  return { gross, exitFee, gas: gasUsd, net: gross - exitFee - gasUsd };
}

export interface VerifiedFeed {
  pools: VerifiedPool[];
  /** Candidates still being verified (background); the browser asks again. */
  pending: number;
  /** Candidates checked and left out, by reason. */
  rejected: Record<VerifyReject, number>;
  /** The same per chain. */
  byChain: Record<string, { candidates: number; verified: number; pending: number; rejected: Record<VerifyReject, number> }>;
  /** Candidates (DefiLlama pools on supported chains, single asset, over the TVL floor). */
  candidates: number;
  /** Supported chains and their explorer (for holder links). */
  explorers: Record<string, string>;
  /** Supported chains' ids (for the gas cost). */
  chainIds: Record<string, number>;
  minTvlUsd: number;
  fetchedAt: string;
}
