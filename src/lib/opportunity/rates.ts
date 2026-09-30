import type { RateQuote } from '../../types/opportunity';

/**
 * Growth factor − 1 of one unit over `days` at a yearly rate given in %, read the
 * way the source publishes it. APR and APY are never interchanged: 10% for 30 days
 * is 0.822% as simple APR and 0.786% as APY.
 *
 * - apy: (1 + r)^(d/365) − 1
 * - apr with a stated compounding n: (1 + r/n)^(n·d/365) − 1
 * - apr without one, or unknown kind: r × d/365 (simple — the lower of the readings
 *   for positive rates, so an unknown kind never inflates the estimate)
 * - quote: null — the family's own model prices it from the executable quote.
 */
export function periodGrowth(rate: Pick<RateQuote, 'value' | 'kind' | 'compoundsPerYear'>, days: number): number | null {
  const r = rate.value;
  if (r === null || !Number.isFinite(r) || !(days >= 0)) return null;
  const f = r / 100;
  const t = days / 365;
  switch (rate.kind) {
    case 'apy':
      return f <= -1 ? null : Math.pow(1 + f, t) - 1;
    case 'apr': {
      const n = rate.compoundsPerYear;
      return n && n > 0 ? Math.pow(1 + f / n, n * t) - 1 : f * t;
    }
    case 'unknown':
      return f * t;
    case 'quote':
      return null;
  }
}

/** Simple (non-compounded) income of an APR in %, e.g. an incentive paid per second at a fixed dollar rate. */
export const simpleIncome = (amount: number, aprPct: number, days: number) => (amount * aprPct * days) / (100 * 365);
