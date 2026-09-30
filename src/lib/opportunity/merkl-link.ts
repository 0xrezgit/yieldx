import type { CostItem, DataQuality, Estimate, Opportunity, OpportunityFamily } from '../../types/opportunity';
import type { GasQuote, MerklOpportunity } from '../merkl/types';
import { calcCampaign, estimate as merklEstimate, needsLoop, type EstimateSettings } from '../merkl/profit';
import { gate, isYieldToken, type VetContext } from '../merkl/vetting';
import { restrictions } from '../merkl/rules';
import { networkByChainId } from '../registry/networks';
import { placeOf } from './estimate';

/**
 * The reward layer across sources.
 *
 * Linking: a Merkl opportunity belongs to a protocol opportunity when both are on
 * the same chain, the Merkl protocol is the same, and Merkl's contract address
 * (explorerAddress, or the address at the start of its identifier) equals the
 * protocol opportunity's market address. Nothing fuzzy: a name or a symbol never
 * links. (Seen in live Merkl data: Morpho vaults link by vault address; Morpho
 * Blue market campaigns carry a 20-byte identifier that is not the market id, so
 * they do not.)
 *
 * Counting once: when linked, the protocol's own report of a reward paid in the
 * same token is dropped and the Merkl campaign — with its end date, rate rule and
 * vetted price — is counted instead. The base rate still comes from the protocol.
 */

const HEX40 = /^0x[0-9a-f]{40}/;

/** Merkl protocol ids that a YieldX adapter covers: their Merkl markets are never listed a second time. */
export const COVERED_BY_ADAPTER: Record<string, string> = { morpho: 'morpho', pendle: 'pendle', spectra: 'spectra', exponent: 'exponent' };

const chainIdOf = (o: Opportunity) => {
  const m = /^eip155:(\d+)$/.exec(o.chain);
  return m ? Number(m[1]) : null;
};

export function merklAddress(m: MerklOpportunity): string | null {
  const e = m.explorerAddress?.toLowerCase() ?? '';
  if (HEX40.test(e) && e.length === 42) return e;
  const id = HEX40.exec(m.identifier.toLowerCase());
  return id ? id[0] : null;
}

/** Protocol opportunity key → the Merkl opportunities that pay rewards on it. */
export function linkMerkl(opps: Opportunity[], merkl: MerklOpportunity[]): Map<string, MerklOpportunity[]> {
  const byAddr = new Map<string, MerklOpportunity[]>();
  for (const m of merkl) {
    const a = merklAddress(m);
    const proto = m.protocol?.id?.toLowerCase();
    if (!a || !proto) continue;
    const k = `${proto}:${m.chain.id}:${a}`;
    byAddr.set(k, [...(byAddr.get(k) ?? []), m]);
  }
  const out = new Map<string, MerklOpportunity[]>();
  for (const o of opps) {
    const chainId = chainIdOf(o);
    const addr = o.market.address?.toLowerCase();
    if (chainId === null || !addr) continue;
    const hit = byAddr.get(`${o.protocol.id}:${chainId}:${addr}`);
    if (hit?.length) out.set(o.key, hit);
  }
  return out;
}

/** Drop protocol-reported rewards paid in a token that a linked Merkl campaign also pays. */
export function withoutMerklDuplicates(o: Opportunity, linked: MerklOpportunity[]): Opportunity {
  const merklTokens = new Set(linked.flatMap((m) => m.campaigns.map((c) => `${c.rewardToken.chainId}:${c.rewardToken.address.toLowerCase()}`)));
  const chainId = chainIdOf(o);
  const rewards = o.rewards.filter((r) => !(r.source === 'protocol' && r.token?.address && merklTokens.has(`${chainId}:${r.token.address.toLowerCase()}`)));
  if (rewards.length === o.rewards.length) return o;
  return { ...o, rewards, notes: [...(o.notes ?? []), 'پاداشی که پروتکل گزارش می‌کرد همان کمپین Merkl است؛ فقط یک‌بار و از روی کمپین Merkl شمرده شد.'] };
}

/**
 * Adds the linked Merkl campaigns to a protocol estimate, each with Merkl's own
 * rule (dilution by your share, capped, fixed…), until its own end within the
 * earning days, at the vetted reward price. Campaigns Merkl's gate rejects, with
 * access conditions, or already counted, are listed but not added.
 */
export function addMerklRewards(e: Estimate, linked: MerklOpportunity[], ctx: VetContext, perTxUsd: (chainId: number) => number): Estimate {
  if (e.net === null || !(e.allocatable > 0)) return e;
  const assumptions = [...e.assumptions];
  const unknown = [...e.unknown];
  const lines = [...e.rewardLines];
  const seen = new Set(lines.map((l) => l.key));
  let added = 0;
  const claimChains = new Set<number>();
  for (const m of linked) {
    const g = gate(m, ctx);
    if (g) {
      assumptions.push(`کمپین Merkl «${m.name}» در گزینش کنار گذاشته شد: ${g.label}`);
      continue;
    }
    for (const c of m.campaigns) {
      const key = `${c.distributionChainId}:${c.campaignId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (restrictions(c).length) {
        assumptions.push(`پاداش ${c.rewardToken.symbol} از Merkl شرط دسترسی دارد؛ لحاظ نشد.`);
        continue;
      }
      if (c.rewardToken.type !== 'TOKEN') continue;
      const x = calcCampaign(c, m, e.allocatable, e.earningDays, ctx);
      if (x.usdPerDay === null || !(x.usdPerDay > 0) || x.status === 'none') {
        unknown.push(`پاداش ${c.rewardToken.symbol} از Merkl به دلار قابل برآورد نبود${x.note ? `: ${x.note}` : ''}${!x.price.ok && x.price.reason ? `: ${x.price.reason.label}` : ''}.`);
        continue;
      }
      const usd = x.usdPerDay * x.days;
      lines.push({ key, label: `پاداش ${c.rewardToken.symbol} (Merkl)`, usd, days: x.days, source: 'merkl' });
      added += usd;
      claimChains.add(c.distributionChainId);
      if (x.note) assumptions.push(`پاداش ${c.rewardToken.symbol}: ${x.note}`);
    }
  }
  if (!added) return { ...e, assumptions, unknown };
  const claims: CostItem[] = [...claimChains].map((chainId) => ({ key: `claim-${chainId}`, label: 'گس دریافت (claim) پاداش Merkl', usd: perTxUsd(chainId), basis: 'assumed' }));
  const costs = [...e.costs, ...claims];
  assumptions.push('پاداش‌های Merkl با قاعده‌ی خود هر کمپین و سهم سرمایه‌ی شما، فقط تا پایان همان کمپین شمرده شدند؛ اثر قیمت فروش پاداش لحاظ نشده.');
  const net = e.net + added - claims.reduce((a, c) => a + c.usd, 0);
  return {
    ...e,
    rewards: e.rewards + added,
    rewardLines: lines,
    costs,
    unknown: unknown.filter((u) => !u.startsWith('گس دریافت پاداش (claim)')),
    assumptions,
    net,
    netPct: (net / e.capital) * 100,
    placement: e.placement === 'ranked' || e.placement === 'unprofitable' || e.placement === 'low-capacity' ? placeOf(e.quality, net, e.allocatable, e.capital) : e.placement,
  };
}

// ─── Merkl-only markets in the shared list ──────────────────────────────────

const FAMILY: Partial<Record<MerklOpportunity['action'], OpportunityFamily>> = { LEND: 'lend', STAKE: 'stake', HOLD: 'stake', POOL: 'lp', BORROW: 'borrow', LONG: 'leverage', SHORT: 'leverage' };

/** A Merkl market as a shared-model opportunity (display and identity; its numbers come from Merkl's engine). */
export function merklAsOpportunity(m: MerklOpportunity, fetchedAt: string): Opportunity {
  const network = networkByChainId(m.chain.id);
  const lead = m.tokens.find((t) => t.type === 'TOKEN') ?? m.tokens[0];
  return {
    key: `merkl:${m.id}`,
    family: needsLoop(m) ? 'leverage' : m.tokens.some(isYieldToken) ? 'yt' : (FAMILY[m.action] ?? 'stake'),
    protocol: { id: m.protocol?.id ?? 'merkl', version: null, name: m.protocol?.name ?? 'Merkl' },
    chain: network.key,
    market: { id: m.id, address: merklAddress(m), name: m.name },
    assets: { deposit: m.tokens.filter((t) => t.type === 'TOKEN').map((t) => ({ symbol: t.symbol, address: t.address })) },
    rate: { value: m.nativeApr, kind: 'apr', feesIncluded: 'unknown', rewardsIncluded: false, at: m.aprAt ? new Date(m.aprAt * 1000).toISOString() : null },
    maturity: null,
    capacity: { depositRemainingUsd: null, withdrawableNowUsd: null },
    exit: { type: 'unknown', note: 'شرایط خروج را Merkl گزارش نمی‌کند؛ در اپ همان پروتکل بررسی کنید.' },
    rewards: [],
    quality: 'current',
    sources: [{ name: 'Merkl API', url: 'https://api.merkl.xyz', fetchedAt, sourceUpdatedAt: m.aprAt ? new Date(m.aprAt * 1000).toISOString() : null }],
    notes: [],
    url: m.depositUrl,
    icon: lead?.icon ?? null,
  };
}

/** Merkl's own estimate, expressed in the shared Estimate shape for one list. */
export function merklEstimateShared(m: MerklOpportunity, o: Opportunity, s: EstimateSettings, ctx: VetContext, gas: GasQuote[], stale: boolean): Estimate {
  const days = s.horizon;
  const base: Estimate = {
    key: o.key,
    capital: s.capital,
    days,
    earningDays: days,
    allocatable: 0,
    unallocated: s.capital,
    unallocatedReason: null,
    rateNow: m.nativeApr,
    rateAfterEntry: null,
    baseIncome: null,
    rewards: 0,
    rewardLines: [],
    debtCost: 0,
    costs: [],
    unknown: [],
    net: null,
    netPct: null,
    assumptions: ['برآورد با موتور Merkl یلدایکس: پاداش هر کمپین با سهم شما تا پایان خودش، به قیمت اعتبارسنجی‌شده.'],
    quality: 'current',
    placement: 'insufficient',
  };
  if (o.family === 'lp' || o.family === 'leverage' || o.family === 'yt' || o.family === 'borrow') {
    return { ...base, placement: 'specialist', assumptions: [...base.assumptions, o.family === 'lp' ? 'استخر نقدینگی: تغییر ارزش دو دارایی (زیان ناپایدار) مدل نشده؛ در «تحلیل تخصصی».' : 'به نرخ وام، اهرم یا ارزش YT بستگی دارد؛ در «تحلیل تخصصی».'] };
  }
  const g = gate(m, ctx);
  if (g) return { ...base, assumptions: [...base.assumptions, g.label] };
  const r = merklEstimate(m, s, ctx, gas);
  if (r.ok === false) return { ...base, assumptions: [...base.assumptions, r.reason.label] };
  const quality: DataQuality = stale ? 'stale' : r.confidence === 'high' ? 'current' : 'partial';
  return {
    ...base,
    allocatable: r.deployed,
    unallocated: 0,
    rateAfterEntry: r.native.counted ? r.native.apr : null,
    baseIncome: r.nativeUsd,
    rewards: r.incentiveUsd,
    rewardLines: r.campaigns
      .filter((x) => x.usdPerDay !== null && x.usdPerDay > 0)
      .map((x) => ({ key: `${x.c.distributionChainId}:${x.c.campaignId}`, label: `پاداش ${x.c.rewardToken.symbol} (Merkl)`, usd: (x.usdPerDay as number) * x.days, days: x.days, source: 'merkl' as const })),
    costs: r.costs,
    unknown: r.unknownCosts,
    net: r.net,
    netPct: (r.net / s.capital) * 100,
    assumptions: [...base.assumptions, r.native.note, ...r.why.map((w) => `اطمینان کمتر: ${w}`), ...r.risks],
    quality,
    placement: placeOf(quality, r.net, r.deployed, s.capital),
  };
}
