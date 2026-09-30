import { hasBoost } from './rules';
import { CAPITAL_ACTIONS, calcCampaign, clampHorizon, needsLoop, type EstimateSettings } from './profit';
import { gate, tokenClass, type PriceCheck, type VetContext } from './vetting';
import { tokenKey, type MerklCampaign, type MerklOpportunity, type MerklToken } from './types';

/**
 * «رتبه‌بندی توکن و پوینت» — what the user's capital could earn, in the reward's
 * own unit, independent of the dollar ranking:
 *
 * - tokens: amount, validated price, dollar value and liquidity; ranked by dollar
 *   value (never by raw count — a million of one token is not better than one of
 *   another). Tokens without a usable price are listed after, unranked.
 * - points: grouped by program unit; ranked only inside a group. Points of two
 *   programs are never converted to dollars or to a shared score.
 * - pre-TGE: amounts only, grouped by token; dollar value unknown.
 */

export interface RewardEntry {
  o: MerklOpportunity;
  c: MerklCampaign;
  token: MerklToken;
  /** Units over the horizon (clipped to the campaign's end) and to its end. */
  units: number;
  unitsToEnd: number;
  days: number;
  daysToEnd: number;
  /** Validated dollar value over the horizon; null when the price is not usable. */
  usd: number | null;
  price: PriceCheck;
  /** Why the amount is approximate. */
  note: string | null;
  /** How the rate is set, and extra conditions (boost…). */
  conditions: string[];
}

export interface RewardGroup {
  key: string;
  token: MerklToken;
  /** Programs behind the unit, when Merkl names them. */
  programs: string[];
  entries: RewardEntry[];
}

export interface RewardBoard {
  tokens: RewardEntry[];
  /** Tokens without a usable price (listed, not ranked). */
  unpriced: RewardEntry[];
  points: RewardGroup[];
  pretge: RewardGroup[];
}

const conditionsOf = (c: MerklCampaign) => {
  const out: string[] = [];
  if (c.rateKind === 'fixedAmount' || c.rateKind === 'fixedPerUnit' || c.rateKind === 'fixedValue') out.push('نرخ ثابت به ازای سپرده');
  else if (c.rateKind === 'pool') out.push('سهم از بودجه‌ی مشترک؛ با TVL رقیق می‌شود');
  else if (c.rateKind === 'capped') out.push('بودجه‌ی مشترک با سقف APR');
  else if (c.rateKind === 'target') out.push('تکمیل تا نرخ هدف');
  if (hasBoost(c)) out.push('ضریب برای برخی کاربران');
  return out;
};

function group(entries: RewardEntry[]): RewardGroup[] {
  const m = new Map<string, RewardGroup>();
  for (const e of entries) {
    const k = tokenKey(e.token.chainId, e.token.address);
    const g = m.get(k) ?? { key: k, token: e.token, programs: [], entries: [] };
    g.entries.push(e);
    for (const p of e.o.programs) if (!g.programs.includes(p.name)) g.programs.push(p.name);
    m.set(k, g);
  }
  const groups = [...m.values()];
  for (const g of groups) g.entries.sort((a, b) => b.units - a.units);
  // Groups are different units: ordered by name, never by size.
  return groups.sort((a, b) => a.token.symbol.localeCompare(b.token.symbol));
}

export function rankRewards(list: MerklOpportunity[], s: EstimateSettings, ctx: VetContext): RewardBoard {
  const all: RewardEntry[] = [];
  if (!(s.capital > 0)) return { tokens: [], unpriced: [], points: [], pretge: [] };
  for (const o of list) {
    if (gate(o, ctx) || !CAPITAL_ACTIONS.has(o.action) || needsLoop(o)) continue;
    for (const c of o.campaigns) {
      if (c.start > ctx.now || c.end <= ctx.now) continue;
      const x = calcCampaign(c, o, s.capital, clampHorizon(s.horizon), ctx);
      if (x.status === 'none' || x.unitsPerDay === null || !(x.unitsPerDay > 0)) continue;
      const usd = x.usdPerDay !== null ? x.usdPerDay * x.days : null;
      all.push({
        o,
        c,
        token: c.rewardToken,
        units: x.unitsPerDay * x.days,
        unitsToEnd: x.unitsPerDay * x.daysToEnd,
        days: x.days,
        daysToEnd: x.daysToEnd,
        usd,
        price: x.price,
        note: x.note,
        conditions: conditionsOf(c),
      });
    }
  }
  const tokens = all.filter((e) => e.token.type === 'TOKEN');
  return {
    tokens: tokens.filter((e) => e.usd !== null).sort((a, b) => (b.usd as number) - (a.usd as number)),
    unpriced: tokens.filter((e) => e.usd === null).sort((a, b) => a.token.symbol.localeCompare(b.token.symbol)),
    points: group(all.filter((e) => e.token.type === 'POINT')),
    pretge: group(all.filter((e) => e.token.type === 'PRETGE')),
  };
}

/** Stables and majors are deep by default; others show their DEX liquidity or «unknown». */
export const liquidityLabel = (e: RewardEntry) => (e.price.depth === 'deep' ? 'deep' : e.price.market ? e.price.market.liquidityUsd : null);
export const isMajor = (t: MerklToken) => tokenClass(t) !== 'other';
