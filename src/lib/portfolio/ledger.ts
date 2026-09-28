import type { Fee, Position, PositionEvent, TokenAmount } from '../../types/position';
import { DAY_MS } from '../utils/math';

/**
 * Replays a position's recorded events into balances and cash flows. Pure
 * bookkeeping: no market data, no assumptions except the borrow APY the user
 * entered for debt interest.
 *
 * Cash-flow convention (USD, at each event's own recorded rate):
 *   contributions (C) = money the user put in: buys, repayments, separate fees on them
 *   withdrawals   (W) = money the user took out: sales, redemptions, claims, borrowed cash
 *   total P&L = (value now − debt now) + W − C
 * so new deposits never count as profit. Borrowed cash is a withdrawal that is spent
 * again on a buy (a contribution); the debt it creates is subtracted from the value.
 *
 * Fees marked `included` are already inside the event's amounts and are only listed,
 * never subtracted again.
 */

export const EPS = 1e-9;

export const usdOf = (t: TokenAmount): number => (t.usdRate === null ? NaN : t.amount * t.usdRate);

/** USD of fees that were paid on top of the event amounts (not already included). */
export function separateFeesUsd(fees: Fee[]): number {
  return fees.filter((f) => !f.included).reduce((s, f) => s + usdOf(f), 0);
}

export function sortEvents(events: PositionEvent[]): PositionEvent[] {
  return events
    .map((e, i) => ({ e, i, t: new Date(e.at).getTime() }))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.e);
}

const growth = (apy: number, days: number) => Math.pow(1 + apy / 100, Math.max(0, days) / 365) - 1;

export interface Ledger {
  /** PT/YT tokens still held. */
  units: number;
  /** Remaining cost basis (average-cost method), USD. */
  costUsd: number;
  /** Remaining cost basis in accounting-asset units; NaN when an event lacks the asset rate. */
  costAsset: number;
  contributionsUsd: number;
  withdrawalsUsd: number;
  contributionsAsset: number;
  withdrawalsAsset: number;
  /** Cash borrowed (USD at borrow time). */
  borrowedUsd: number;
  borrowedAsset: number;
  /** Realised: sale gains + income − fees paid on claims/loans − interest paid. */
  realizedUsd: number;
  /** Realised gain from sales/redemptions only. */
  tradeGainUsd: number;
  incomeYieldUsd: number;
  incomeRewardUsd: number;
  /** Every fee, including ones already inside amounts, by kind (USD). */
  fees: { network: number; trade: number; other: number; total: number; separate: number };
  /** Debt balance in debt-asset units, with interest accrued to `asOf`. */
  debtUnits: number;
  /** Interest accrued over the life of the loan (debt-asset units). */
  interestUnits: number;
  interestPaidUsd: number;
  /** Tokens bought in total (for average entry figures). */
  boughtUnits: number;
  boughtCostUsd: number;
  boughtCostAsset: number;
  firstAt: string | null;
  lastAt: string | null;
  /** Start of the current unclaimed-yield period (last claim or first buy). */
  yieldSince: string | null;
  /** Events whose USD or asset rate is missing — their effect on P&L is unknown. */
  missingRates: number;
  hasExit: boolean;
  /** Holding intervals since `from`: units held from `start` to `end` (ms). */
  holdings: { start: number; end: number; units: number }[];
}

/**
 * @param asOf    time the balances are computed for (debt interest accrues until then)
 * @param borrowAPY  debt interest rate, % — from the position's loop details
 */
export function buildLedger(p: Pick<Position, 'events' | 'loop'>, asOf = Date.now(), borrowAPY = p.loop?.borrowAPY ?? 0): Ledger {
  const L: Ledger = {
    units: 0,
    costUsd: 0,
    costAsset: 0,
    contributionsUsd: 0,
    withdrawalsUsd: 0,
    contributionsAsset: 0,
    withdrawalsAsset: 0,
    borrowedUsd: 0,
    borrowedAsset: 0,
    realizedUsd: 0,
    tradeGainUsd: 0,
    incomeYieldUsd: 0,
    incomeRewardUsd: 0,
    fees: { network: 0, trade: 0, other: 0, total: 0, separate: 0 },
    debtUnits: 0,
    interestUnits: 0,
    interestPaidUsd: 0,
    boughtUnits: 0,
    boughtCostUsd: 0,
    boughtCostAsset: 0,
    firstAt: null,
    lastAt: null,
    yieldSince: null,
    missingRates: 0,
    hasExit: false,
    holdings: [],
  };

  let lastT: number | null = null;
  let interestOutstanding = 0;
  const accrue = (t: number) => {
    if (lastT !== null && L.debtUnits > EPS && t > lastT) {
      const i = L.debtUnits * growth(borrowAPY, (t - lastT) / DAY_MS);
      L.debtUnits += i;
      L.interestUnits += i;
      interestOutstanding += i;
    }
  };
  const hold = (t: number) => {
    if (lastT !== null && L.units > EPS && t > lastT) L.holdings.push({ start: lastT, end: t, units: L.units });
  };

  for (const e of sortEvents(p.events)) {
    const t = new Date(e.at).getTime();
    if (!Number.isFinite(t)) continue;
    accrue(t);
    hold(t);
    lastT = t;
    L.firstAt ??= e.at;
    L.lastAt = e.at;

    for (const f of e.fees) {
      const v = usdOf(f);
      if (!Number.isFinite(v)) continue;
      L.fees[f.kind] += v;
      L.fees.total += v;
      if (!f.included) L.fees.separate += v;
    }

    const cashUsd = usdOf(e.cash);
    const feeUsd = separateFeesUsd(e.fees);
    const a = e.assetUsd && e.assetUsd > 0 ? e.assetUsd : NaN;
    if (!Number.isFinite(cashUsd) || !Number.isFinite(feeUsd) || !Number.isFinite(a)) L.missingRates++;
    const toAsset = (usd: number) => usd / a;

    switch (e.type) {
      case 'buy': {
        const cost = cashUsd + feeUsd;
        L.units += e.units;
        L.costUsd += cost;
        L.costAsset += toAsset(cost);
        L.boughtUnits += e.units;
        L.boughtCostUsd += cost;
        L.boughtCostAsset += toAsset(cost);
        L.contributionsUsd += cost;
        L.contributionsAsset += toAsset(cost);
        L.yieldSince ??= e.at;
        break;
      }
      case 'sell':
      case 'redeem': {
        const u = Math.min(e.units, L.units);
        const share = L.units > EPS ? u / L.units : 0;
        const removedUsd = L.costUsd * share;
        const removedAsset = L.costAsset * share;
        const proceeds = cashUsd - feeUsd;
        L.units -= u;
        if (L.units < EPS) L.units = 0;
        L.costUsd -= removedUsd;
        L.costAsset -= removedAsset;
        L.tradeGainUsd += proceeds - removedUsd;
        L.realizedUsd += proceeds - removedUsd;
        L.withdrawalsUsd += proceeds;
        L.withdrawalsAsset += toAsset(proceeds);
        L.hasExit = true;
        break;
      }
      case 'claim_yield':
      case 'claim_reward': {
        const net = cashUsd - feeUsd;
        if (e.type === 'claim_yield') {
          L.incomeYieldUsd += net;
          L.yieldSince = e.at;
        } else L.incomeRewardUsd += net;
        L.realizedUsd += net;
        L.withdrawalsUsd += net;
        L.withdrawalsAsset += toAsset(net);
        break;
      }
      case 'borrow': {
        L.debtUnits += e.cash.amount;
        L.borrowedUsd += cashUsd;
        L.borrowedAsset += toAsset(cashUsd);
        L.withdrawalsUsd += cashUsd;
        L.withdrawalsAsset += toAsset(cashUsd);
        L.contributionsUsd += feeUsd;
        L.contributionsAsset += toAsset(feeUsd);
        L.realizedUsd -= feeUsd;
        break;
      }
      case 'repay': {
        const paid = Math.min(e.cash.amount, L.debtUnits);
        const interestPaid = Math.min(paid, interestOutstanding);
        interestOutstanding -= interestPaid;
        L.debtUnits -= paid;
        if (L.debtUnits < EPS) L.debtUnits = 0;
        const rate = e.cash.usdRate ?? NaN;
        L.interestPaidUsd += interestPaid * rate;
        L.realizedUsd -= interestPaid * rate + feeUsd;
        L.contributionsUsd += cashUsd + feeUsd;
        L.contributionsAsset += toAsset(cashUsd + feeUsd);
        break;
      }
    }
  }

  if (lastT !== null && asOf > lastT) {
    accrue(asOf);
    hold(asOf);
  }
  return L;
}

/** Contributions net of borrowed cash: the user's own money in the position. */
export const ownCapitalUsd = (L: Ledger) => L.contributionsUsd - L.borrowedUsd;
