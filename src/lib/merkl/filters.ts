import { normalizeSearch } from '../utils/formatting';
import { ACTION, merklNetwork, restrictions } from './rules';
import { isMeme, isRobinhoodChain, tokenClass } from './vetting';
import type { MerklAction, MerklOpportunity, MerklToken } from './types';

const DAY = 86_400;

export const firstEnd = (o: MerklOpportunity) => (o.campaigns.length ? Math.min(...o.campaigns.map((c) => c.end)) : 0);
export const lastEnd = (o: MerklOpportunity) => (o.campaigns.length ? Math.max(...o.campaigns.map((c) => c.end)) : 0);
export const rewardTypes = (o: MerklOpportunity) => new Set(o.campaigns.map((c) => c.rewardToken.type));

/** The token that stands for the opportunity (deposit token with a logo first). */
export function leadToken(o: MerklOpportunity): MerklToken | null {
  return o.tokens.find((t) => t.icon) ?? o.tokens[0] ?? null;
}

/** Campaigns still running at `now` — the list is refreshed every minute, but campaigns can end in between. */
export const liveAt = (o: MerklOpportunity, now: number): MerklOpportunity => {
  const campaigns = o.campaigns.filter((c) => c.start <= now && c.end > now);
  return campaigns.length === o.campaigns.length ? o : { ...o, campaigns };
};

/** Has a Robinhood-Chain memecoin among its deposit or reward tokens. */
export const hasRobinhoodMeme = (o: MerklOpportunity) => isRobinhoodChain(o.chain.id) && [...o.tokens, ...o.campaigns.map((c) => c.rewardToken)].some(isMeme);

// ─── Filters ─────────────────────────────────────────────────────────────────

export interface MerklFilters {
  q: string;
  chain: number | 'all';
  protocol: string | 'all';
  action: MerklAction | 'all';
  stable: boolean;
  watchOnly: boolean;
  /** Hide Robinhood-Chain memecoin opportunities (the only memes shown at all). */
  hideMeme: boolean;
}

export const defaultMerklFilters: MerklFilters = { q: '', chain: 'all', protocol: 'all', action: 'all', stable: false, watchOnly: false, hideMeme: false };

export const isStableOpp = (o: MerklOpportunity) => {
  const deposit = o.tokens.filter((t) => t.type === 'TOKEN');
  return deposit.length > 0 && deposit.every((t) => tokenClass(t) === 'usd');
};
export const isRestricted = (o: MerklOpportunity) => o.campaigns.some((c) => restrictions(c).length > 0);

export function searchText(o: MerklOpportunity): string {
  const net = merklNetwork(o.chain);
  return normalizeSearch(
    [o.name, o.protocol?.name, o.protocol?.id, net.name, net.nameFa, ACTION[o.action].label, o.identifier, ...o.programs.map((p) => p.name), ...o.tokens.map((t) => t.symbol), ...o.campaigns.map((c) => c.rewardToken.symbol)]
      .filter(Boolean)
      .join(' '),
  );
}

export function applyMerklFilters(list: MerklOpportunity[], f: MerklFilters, watch: ReadonlySet<string> = new Set()): MerklOpportunity[] {
  const q = normalizeSearch(f.q);
  return list.filter(
    (o) =>
      (f.chain === 'all' || o.chain.id === f.chain) &&
      (f.protocol === 'all' || o.protocol?.id === f.protocol) &&
      (f.action === 'all' || o.action === f.action) &&
      (!f.stable || isStableOpp(o)) &&
      (!f.watchOnly || watch.has(o.id)) &&
      (!f.hideMeme || !hasRobinhoodMeme(o)) &&
      (!q || q.split(' ').every((w) => searchText(o).includes(w))),
  );
}

// ─── Flags ───────────────────────────────────────────────────────────────────

export interface Flag {
  tone: 'warning' | 'danger' | 'info';
  label: string;
}

/** Risks and caveats in words, most serious first. */
export function flags(o: MerklOpportunity, now = Date.now() / 1000): Flag[] {
  const out: Flag[] = [];
  const types = rewardTypes(o);
  if (hasRobinhoodMeme(o)) out.push({ tone: 'danger', label: 'میم‌کوین — ریسک بسیار بالا' });
  if (o.protocol && o.protocol.hacks > 0) out.push({ tone: 'warning', label: 'سابقه‌ی هک در پروتکل' });
  if (isRestricted(o)) out.push({ tone: 'danger', label: 'شرط دسترسی دارد' });
  if (o.tvl < 100_000) out.push({ tone: 'warning', label: 'TVL کم' });
  if (o.apr > 100) out.push({ tone: 'warning', label: 'APR غیرعادی بالا' });
  if (o.campaigns.length && (firstEnd(o) - now) / DAY < 3) out.push({ tone: 'warning', label: 'پایان کمتر از ۳ روز' });
  if (o.campaigns.some((c) => c.clmm)) out.push({ tone: 'info', label: 'وابسته به بازه‌ی قیمت' });
  if (types.has('POINT')) out.push({ tone: 'info', label: 'پوینت' });
  if (types.has('PRETGE')) out.push({ tone: 'info', label: 'توکن عرضه‌نشده' });
  return out;
}
