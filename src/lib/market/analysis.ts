import type { Estimate, Opportunity, Placement } from '../../types/opportunity';
import type { GasQuote, MerklOpportunity } from '../merkl/types';
import type { VetContext } from '../merkl/vetting';
import { estimate } from '../opportunity/estimate';
import { dedupeOpportunities, rankEstimates, type Ranking } from '../opportunity/rank';
import { PT_UNKNOWN_COSTS } from '../opportunity/from-market';
import { addMerklRewards, COVERED_BY_ADAPTER, linkMerkl, merklAsOpportunity, merklEstimateShared, withoutMerklDuplicates } from '../opportunity/merkl-link';
import { buildLoops, buildPtLoops, defaultLeverageInput } from '../opportunity/leverage';
import { claimCost, FALLBACK_TX_USD, gasLines } from '../opportunity/costs';
import { HORIZONS, MODEL_VERSION, RANKING_VERSION, TOP_LIMIT, type HorizonDays } from '../opportunity/policy';
import { networkByKey } from '../registry/networks';
import { normalizeSearch } from '../utils/formatting';

/**
 * «تحلیل بازار» — one pipeline for every family and every horizon:
 *
 *   discover (adapters, Merkl) → dedupe → link rewards → build loops
 *   → estimate each opportunity for the capital at 30, 60, 90 and 125 days
 *   → per horizon: rank by net dollars over the whole list, keep at most 60.
 *
 * Each horizon is estimated on its own (maturities, campaign ends and costs differ),
 * never scaled from another. Nothing below the cut is dropped: it stays in `rows`
 * and can enter with another capital, horizon or data.
 */

export interface MerklInput {
  /** Live Merkl opportunities (campaigns already cut to those running now). */
  list: MerklOpportunity[];
  ctx: VetContext;
  stale: boolean;
  fetchedAt: string;
}

export interface AnalysisInput {
  /** Protocol opportunities from every adapter (lending, vaults, fixed rate, PT). */
  opportunities: Opportunity[];
  merkl: MerklInput | null;
  /** Measured gas prices (from the Merkl feed); empty → stated defaults. */
  gas: GasQuote[];
}

export interface Evaluated {
  o: Opportunity;
  byHorizon: Record<HorizonDays, Estimate>;
  /** Merkl opportunities behind its rewards (linked by address, or the Merkl market itself). */
  merkl: MerklOpportunity[];
}

export interface Analysis {
  capital: number;
  rows: Evaluated[];
  byKey: Map<string, Opportunity>;
  rowByKey: Map<string, Evaluated>;
  /** Protocol opportunities with Merkl rewards linked by exact address. */
  linked: number;
  modelVersion: string;
  rankingVersion: string;
}

export type FamilyFilter = 'all' | 'lend' | 'vault' | 'fixed' | 'leverage' | 'rewards';

export const FAMILY_FILTERS: { id: FamilyFilter; label: string }[] = [
  { id: 'all', label: 'همه' },
  { id: 'lend', label: 'وام‌دهی' },
  { id: 'vault', label: 'خزانه' },
  { id: 'fixed', label: 'سررسیددار' },
  { id: 'leverage', label: 'اهرم' },
  { id: 'rewards', label: 'پاداش‌دار' },
];

const inFamily = (f: FamilyFilter, o: Opportunity, e: Estimate) =>
  f === 'all' ||
  (f === 'fixed' && (o.family === 'fixed-lend' || o.family === 'pt' || (o.family === 'leverage' && o.maturity !== null))) ||
  (f === 'lend' && o.family === 'lend') ||
  (f === 'vault' && o.family === 'vault') ||
  (f === 'rewards' && e.rewards > 0) ||
  (f === 'leverage' && o.family === 'leverage');

/** Text that a search matches: symbols, protocol, network, market name and addresses. */
export function searchText(o: Opportunity): string {
  const n = networkByKey(o.chain);
  return [o.market.name, o.market.address, o.protocol.name, n.name, n.nameFa, ...o.assets.deposit.flatMap((t) => [t.symbol, t.address]), ...(o.assets.debt ?? []).map((t) => t.symbol)]
    .filter(Boolean)
    .map((x) => normalizeSearch(String(x)))
    .join(' ');
}

/** Every opportunity estimated for this capital at every horizon. */
export function evaluate(input: AnalysisInput, capital: number, now = Date.now()): Analysis {
  const base = dedupeOpportunities(input.opportunities);
  // Borrow-only reserves feed loops, not the earn list.
  const opps = dedupeOpportunities([...base.filter((o) => o.family !== 'borrow'), ...buildLoops(base), ...buildPtLoops(base)]);
  const merkl = input.merkl;
  const links = merkl ? linkMerkl(opps, merkl.list) : new Map<string, MerklOpportunity[]>();
  const perClaim = claimCost(input.gas);

  const rows: Evaluated[] = opps.map((raw) => {
    const linked = links.get(raw.key);
    const o = linked ? withoutMerklDuplicates(raw, linked) : raw;
    const g = gasLines(o, input.gas);
    const byHorizon = {} as Record<HorizonDays, Estimate>;
    for (const days of HORIZONS) {
      let e = estimate(o, {
        capital,
        days,
        entryCosts: g.entry,
        exitCosts: g.exit,
        unknownCosts: o.family === 'pt' ? [...PT_UNKNOWN_COSTS] : o.rewards.length ? ['گس دریافت پاداش (claim)'] : [],
        now,
        leverage: defaultLeverageInput,
      });
      if (linked && merkl) e = addMerklRewards(e, linked, merkl.ctx, perClaim);
      byHorizon[days] = e;
    }
    return { o, byHorizon, merkl: linked ?? [] };
  });

  if (merkl) {
    const linkedIds = new Set([...links.values()].flat().map((m) => m.id));
    const known = new Set(opps.map((o) => `${o.chain}:${o.market.address?.toLowerCase()}`));
    for (const m of merkl.list) {
      if (linkedIds.has(m.id) || COVERED_BY_ADAPTER[m.protocol?.id?.toLowerCase() ?? '']) continue;
      const o = merklAsOpportunity(m, merkl.fetchedAt);
      // The same contract already reached through an adapter is one market, not two rows.
      if (o.market.address && known.has(`${o.chain}:${o.market.address.toLowerCase()}`)) continue;
      const byHorizon = {} as Record<HorizonDays, Estimate>;
      for (const days of HORIZONS) {
        byHorizon[days] = merklEstimateShared(m, o, { capital, horizon: days, txEthereum: FALLBACK_TX_USD.ethereum, txOther: FALLBACK_TX_USD.evm }, merkl.ctx, input.gas, merkl.stale);
      }
      rows.push({ o, byHorizon, merkl: [m] });
    }
  }

  return { capital, rows, byKey: new Map(rows.map((r) => [r.o.key, r.o])), rowByKey: new Map(rows.map((r) => [r.o.key, r])), linked: links.size, modelVersion: MODEL_VERSION, rankingVersion: RANKING_VERSION };
}

export interface HorizonView {
  days: HorizonDays;
  ranking: Ranking;
  /** Opportunities evaluated in this domain. */
  total: number;
  counts: Record<Placement, number>;
  /** The competition domain was narrowed by a filter or a search. */
  narrowed: boolean;
}

/** The top list of one horizon, re-selected from the whole domain the filter and search leave. */
export function selectHorizon(a: Analysis, days: HorizonDays, filter: FamilyFilter = 'all', query = '', limit = TOP_LIMIT): HorizonView {
  const q = normalizeSearch(query);
  const list = a.rows.filter((r) => inFamily(filter, r.o, r.byHorizon[days]) && (!q || searchText(r.o).includes(q)));
  const exits = new Map(list.map((r) => [r.o.key, r.o.exit.type]));
  const ranking = rankEstimates(
    list.map((r) => r.byHorizon[days]),
    limit,
    (k) => exits.get(k) ?? 'unknown',
  );
  const counts = { ranked: ranking.top.length + ranking.rest.length } as Record<Placement, number>;
  for (const [p, l] of Object.entries(ranking.aside)) counts[p as Placement] = l.length;
  return { days, ranking, total: list.length, counts, narrowed: filter !== 'all' || !!q };
}
