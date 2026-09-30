import type { Estimate, Opportunity, Placement } from '../../types/opportunity';
import { qualityRank } from './estimate';

export const TOP_LIMIT = 30;

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
  /** Everything else, by why it is not in the top list. */
  aside: Record<Exclude<Placement, 'ranked'>, Estimate[]>;
}

/**
 * Ranks by the estimated net dollars for the same capital and the same period.
 * Risk and data quality filter; they are not part of the score. Ties go to the
 * better data, then to more capital deployed.
 */
export function rankEstimates(estimates: Estimate[], limit = TOP_LIMIT): Ranking {
  const aside: Ranking['aside'] = { 'low-capacity': [], unprofitable: [], 'beyond-horizon': [], specialist: [], stale: [], insufficient: [] };
  const ranked: Estimate[] = [];
  for (const e of estimates) {
    if (e.placement === 'ranked') ranked.push(e);
    else aside[e.placement].push(e);
  }
  ranked.sort((a, b) => (b.net ?? -Infinity) - (a.net ?? -Infinity) || qualityRank(a.quality) - qualityRank(b.quality) || b.allocatable - a.allocatable);
  return { top: ranked.slice(0, limit), aside };
}
