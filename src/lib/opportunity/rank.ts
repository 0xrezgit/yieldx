import type { Estimate, ExitTerms, Opportunity, Placement } from '../../types/opportunity';
import { qualityRank } from './estimate';
import { TOP_LIMIT } from './policy';

export { TOP_LIMIT };

/**
 * One market reached through several paths (its protocol's API, Merkl, a second
 * program) appears once: the better-quality record wins, and reward streams are
 * merged by campaign key so the same campaign is never counted twice.
 */
export function dedupeOpportunities(list: Opportunity[]): Opportunity[] {
  const byKey = new Map<string, Opportunity>();
  for (const o of list) {
    const prev = byKey.get(o.key);
    if (!prev) {
      byKey.set(o.key, o);
      continue;
    }
    const [keep, other] = qualityRank(o.quality) < qualityRank(prev.quality) ? [o, prev] : [prev, o];
    const rewards = [...keep.rewards];
    const seen = new Set(rewards.map((r) => r.key));
    for (const r of other.rewards) if (!seen.has(r.key)) rewards.push(r);
    byKey.set(o.key, { ...keep, rewards, sources: [...keep.sources, ...other.sources] });
  }
  return [...byKey.values()];
}

export interface Ranking {
  /** Best net profit first, at most `limit` rows — fewer when fewer qualify. */
  top: Estimate[];
  /** Ranked but below the cut. They stay in the model and can enter with other inputs. */
  rest: Estimate[];
  /** Everything else, by why it is not ranked. */
  aside: Record<Exclude<Placement, 'ranked'>, Estimate[]>;
}

const EXIT_ORDER: ExitTerms['type'][] = ['instant', 'maturity', 'secondary', 'queue', 'unknown'];
/** Cents: two results that round to the same cent are a real tie. */
const cents = (x: number | null) => (x === null ? -Infinity : Math.round(x * 100));

/**
 * Net dollars, then — only on a real tie — better data, easier exit, and a stable key.
 * Risk is not part of the score.
 */
export function compareEstimates(a: Estimate, b: Estimate, exitOf: (key: string) => ExitTerms['type'] = () => 'unknown'): number {
  return (
    cents(b.net) - cents(a.net) ||
    qualityRank(a.quality) - qualityRank(b.quality) ||
    EXIT_ORDER.indexOf(exitOf(a.key)) - EXIT_ORDER.indexOf(exitOf(b.key)) ||
    (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
}

export const emptyAside = (): Ranking['aside'] => ({ unprofitable: [], 'needs-model': [], 'no-capacity': [], stale: [], insufficient: [], inactive: [], rejected: [] });

/**
 * Ranks by the estimated net dollars for the same capital and the same horizon, over
 * the whole qualifying list, then keeps at most `limit`. No family has a quota.
 */
export function rankEstimates(estimates: Estimate[], limit = TOP_LIMIT, exitOf?: (key: string) => ExitTerms['type']): Ranking {
  const aside = emptyAside();
  const ranked: Estimate[] = [];
  for (const e of estimates) {
    if (e.placement === 'ranked') ranked.push(e);
    else aside[e.placement].push(e);
  }
  ranked.sort((a, b) => compareEstimates(a, b, exitOf));
  return { top: ranked.slice(0, limit), rest: ranked.slice(limit), aside };
}
