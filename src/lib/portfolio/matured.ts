import type { Position, PositionEvent } from '../../types/position';
import type { Valuation } from './valuation';

/** An amount of one token (summed over events). */
export interface TokenSum {
  token: string;
  amount: number;
  /** USD at the events' own rates; null when a rate is missing. */
  usd: number | null;
}

export interface MaturedSummary {
  id: string;
  /** First buy. */
  enteredAt: string | null;
  /** Last sale / redemption; null when no exit is recorded yet. */
  exitedAt: string | null;
  maturity: string;
  /** What was paid in (buy events), per token. */
  paid: TokenSum[];
  /** What came out (sell / redeem events), per token. Empty when nothing is recorded. */
  received: TokenSum[];
  /** No exit recorded: the output is the estimate at maturity (PT → 1 asset unit each, YT → 0). */
  estimated: boolean;
  /** Estimated output in accounting-asset units and USD when no exit is recorded. */
  estimateUnits: number | null;
  estimateUsd: number | null;
  pnlUsd: number;
  pnlPct: number;
}

function sum(events: PositionEvent[]): TokenSum[] {
  const by = new Map<string, TokenSum>();
  for (const e of events) {
    const key = e.cash.token.trim();
    const s = by.get(key.toLowerCase()) ?? { token: key, amount: 0, usd: 0 };
    s.amount += e.cash.amount;
    s.usd = s.usd === null || e.cash.usdRate === null ? null : s.usd + e.cash.amount * e.cash.usdRate;
    by.set(key.toLowerCase(), s);
  }
  return [...by.values()];
}

/**
 * Short record of a position whose maturity date has passed: when it was entered
 * and exited, what went in, what came out, and the P&L. Only recorded events are
 * used; when no exit is recorded the output is an estimate, and it is labelled so.
 */
export function maturedSummary(p: Position, v: Valuation): MaturedSummary {
  const sorted = [...p.events].sort((a, b) => a.at.localeCompare(b.at));
  const buys = sorted.filter((e) => e.type === 'buy');
  const exits = sorted.filter((e) => e.type === 'sell' || e.type === 'redeem');
  const estimated = v.ledger.units > 1e-9;
  const isPT = p.kind !== 'yt';
  return {
    id: p.id,
    enteredAt: buys[0]?.at ?? null,
    exitedAt: exits.length ? exits[exits.length - 1].at : null,
    maturity: p.maturity,
    paid: sum(buys),
    received: sum(exits),
    estimated,
    estimateUnits: estimated ? (isPT ? v.ledger.units : 0) : null,
    estimateUsd: estimated ? v.exit.proceedsUsd : null,
    pnlUsd: v.pnlUsd,
    pnlPct: v.pnlPct,
  };
}
