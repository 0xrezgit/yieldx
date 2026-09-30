import { restrictions } from './rules';
import { tokenKey, type MerklOpportunity, type MerklToken, type TokenMarket } from './types';

/**
 * Which Merkl opportunities and tokens YieldX is willing to show, and why not.
 *
 * Every rule has a stable `code` (for tests and counting) and a Persian label (for
 * the screen). Nothing here is tuned to fill a list: an opportunity that fails a
 * gate is left out even if that leaves fewer than thirty.
 */

const DAY = 86_400;
const HOUR = 3_600;

// ─── Thresholds (all visible in the UI's «معیارها») ─────────────────────────

export const RULES = {
  /** Merkl's APR/TVL snapshot older than this is stale. Merkl snapshots daily. */
  recordMaxAgeH: 48,
  /** Reward-token price older than this is not trusted for dollars. */
  priceMaxAgeH: 48,
  /** A campaign with less time left than this is not ranked. */
  minDaysLeft: 1,
  /** Opportunity TVL below this: the APR swings with every deposit. */
  minTvl: 10_000,
  /** APR above this is treated as a data error. */
  absurdApr: 10_000,
  /** Reward token needs at least this much DEX liquidity to be valued in dollars. */
  minRewardLiquidity: 10_000,
  /** Merkl's price may differ from the DEX price by at most this fraction. */
  maxPriceGap: 0.25,
  /** Robinhood-Chain memecoins: stricter liquidity and price agreement. */
  memeMinLiquidity: 20_000,
  memeMaxPriceGap: 0.2,
  memePriceMaxAgeH: 6,
} as const;

export interface Reason {
  code: string;
  label: string;
}

const r = (code: string, label: string): Reason => ({ code, label });

// ─── Token classes ───────────────────────────────────────────────────────────

const ROBINHOOD_CHAIN = 4663;
export const isRobinhoodChain = (chainId: number) => chainId === ROBINHOOD_CHAIN;

/** USD stablecoins: priced near one dollar. */
const USD_STABLE = /^(w|s|a|c|st|x)?(usdc(\.e)?|usdt0?|usde|usds|dai|gho|frxusd|pyusd|rlusd|usdg|ausd|usd0|usd1|usdh|bold|lusd|crvusd|fdusd|tusd|usdb|usdx|dola|mim|susd|avusd|usdai|usdtb|eusd|feusd|usdm)$/i;
const ETH_LIKE = /^(eth|weth|steth|wsteth|weeth|reth|cbeth|ezeth|rseth|meth|oeth|woeth|frxeth|sfrxeth|pufeth|ethx)$/i;
const BTC_LIKE = /^(btc|wbtc|cbbtc|tbtc|lbtc|btcb|solvbtc|fbtc|ubtc|kbtc)$/i;

/** Well-known memecoins by symbol, plus words that mark one in a name or symbol. */
const MEME_SYMBOLS = new Set(['pepe', 'doge', 'shib', 'floki', 'bonk', 'wif', 'brett', 'mog', 'popcat', 'turbo', 'neiro', 'spx', 'giga', 'pnut', 'moodeng', 'fartcoin', 'trump', 'wojak', 'toshi', 'degen', 'ponke', 'mew', 'bome', 'meme', 'clawbank', 'cashcat']);
const MEME_WORDS = /\b(inu|doge|pepe|shib|floki|bonk|wojak|memes?|cat|frog|elon|moon|chad|pump|milady|frens?)\b/i;

export type TokenClass = 'usd' | 'eth' | 'btc' | 'other';

export function tokenClass(t: Pick<MerklToken, 'symbol'>): TokenClass {
  const s = t.symbol.trim();
  if (USD_STABLE.test(s)) return 'usd';
  if (ETH_LIKE.test(s)) return 'eth';
  if (BTC_LIKE.test(s)) return 'btc';
  return 'other';
}

/**
 * Dollar-backed: a USD stablecoin, or a vault / lending share of one (kUSDC,
 * pendleUSDC, fGHO…) priced close to a dollar — it only accrues yield on top.
 */
export function isDollarLike(t: Pick<MerklToken, 'symbol' | 'price' | 'type'>): boolean {
  if (t.type !== 'TOKEN') return false;
  if (tokenClass(t) === 'usd') return true;
  return /usd|gho|dai|bold|dola/i.test(t.symbol) && t.price !== null && t.price >= 0.97 && t.price <= 1.25;
}

/**
 * Memecoin by a known symbol or a meme word in its name or symbol. Stables and
 * majors never are. A tiny unit price alone is not a sign: governance tokens (GEAR)
 * and peso-pegged stablecoins (wARS, COLt) trade below a tenth of a cent.
 */
export function isMeme(t: Pick<MerklToken, 'symbol' | 'name' | 'type'>): boolean {
  if (t.type !== 'TOKEN' || tokenClass(t) !== 'other') return false;
  if (MEME_SYMBOLS.has(t.symbol.trim().toLowerCase())) return true;
  return MEME_WORDS.test(t.name) || MEME_WORDS.test(t.symbol);
}

/** Leveraged, principal-decaying or yield-stripped tokens whose own value moves apart from the underlying. */
export const isYieldToken = (t: Pick<MerklToken, 'symbol'>) => /^YT[-_]/i.test(t.symbol);

// ─── Context ─────────────────────────────────────────────────────────────────

export interface VetContext {
  now: number;
  markets: Record<string, TokenMarket | null>;
  /** Chains DexScreener covers. */
  marketChains: Set<number>;
  /** Reference USD prices from verified tokens in the same feed. */
  ref: { eth: number | null; btc: number | null };
  /** Verified tokens by chain+symbol, to catch look-alikes. */
  verifiedBySymbol: Map<string, MerklToken[]>;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function buildContext(list: MerklOpportunity[], markets: Record<string, TokenMarket | null> = {}, marketChains: number[] = [], now = Date.now() / 1000): VetContext {
  const all = list.flatMap((o) => [...o.tokens, ...o.campaigns.map((c) => c.rewardToken)]);
  const priced = (re: RegExp) => median(all.filter((t) => t.verified && t.price !== null && re.test(t.symbol) && /^(w?eth|w?btc|cbbtc)$/i.test(t.symbol)).map((t) => t.price as number));
  const verifiedBySymbol = new Map<string, MerklToken[]>();
  for (const t of all) {
    if (!t.verified || t.type !== 'TOKEN') continue;
    const k = `${t.chainId}:${t.symbol.toLowerCase()}`;
    const list = verifiedBySymbol.get(k) ?? [];
    if (!list.some((x) => x.address.toLowerCase() === t.address.toLowerCase())) list.push(t);
    verifiedBySymbol.set(k, list);
  }
  return { now, markets, marketChains: new Set(marketChains), ref: { eth: priced(/eth/i), btc: priced(/btc/i) }, verifiedBySymbol };
}

export const marketOf = (t: MerklToken, ctx: VetContext): TokenMarket | null | undefined => ctx.markets[tokenKey(t.chainId, t.address)];

/**
 * A token posing as something it is not: a stable or major symbol at the wrong
 * price, or an unverified token sharing a verified token's symbol on the same chain
 * at a clearly different price.
 */
export function suspicion(t: MerklToken, ctx: VetContext): Reason | null {
  if (t.type !== 'TOKEN') return null;
  const cls = tokenClass(t);
  const p = t.price;
  if (p !== null) {
    if (cls === 'usd' && (p < 0.9 || p > 1.1)) return r('fake-price', `«${t.symbol}» با قیمت ${p.toPrecision(3)} دلار؛ نام استیبل‌کوین با قیمت ناهمخوان`);
    const ref = cls === 'eth' ? ctx.ref.eth : cls === 'btc' ? ctx.ref.btc : null;
    // Liquid-staking tokens trade a little above the base asset; a factor of 1.5 is far outside that.
    if (ref !== null && (p < ref * 0.6 || p > ref * 1.5)) return r('fake-price', `«${t.symbol}» با قیمتی دور از دارایی هم‌نام`);
  }
  if (!t.verified) {
    const twins = (ctx.verifiedBySymbol.get(`${t.chainId}:${t.symbol.toLowerCase()}`) ?? []).filter((x) => x.address.toLowerCase() !== t.address.toLowerCase());
    if (twins.length && (p === null || twins.every((x) => x.price === null || Math.abs(p / x.price - 1) > 0.2))) return r('lookalike', `«${t.symbol}» تأییدنشده و هم‌نام با توکن معتبر دیگری در همین شبکه`);
  }
  return null;
}

/**
 * Robinhood-Chain memecoins are the only memes allowed, and only after an
 * independent check: verified by Merkl, a fresh price, a real DEX market with depth,
 * and Merkl's price agreeing with that market.
 */
export function robinhoodMemeCheck(t: MerklToken, ctx: VetContext): Reason | null {
  if (!isRobinhoodChain(t.chainId)) return r('meme', `میم‌کوین «${t.symbol}»`);
  if (!t.verified) return r('meme-unverified', `میم‌کوین Robinhood Chain «${t.symbol}» بدون تأیید Merkl`);
  if (t.price === null || t.priceAt === null || ctx.now - t.priceAt > RULES.memePriceMaxAgeH * HOUR) return r('meme-price', `میم‌کوین «${t.symbol}» بدون قیمت تازه`);
  const m = marketOf(t, ctx);
  if (!m || m.liquidityUsd < RULES.memeMinLiquidity) return r('meme-liquidity', `میم‌کوین «${t.symbol}» با نقدشوندگی DEX ناکافی`);
  if (m.dexPrice === null || Math.abs(t.price / m.dexPrice - 1) > RULES.memeMaxPriceGap) return r('meme-price-gap', `قیمت میم‌کوین «${t.symbol}» با بازار DEX هم‌خوان نیست`);
  return null;
}

/** Tokens of an opportunity that are memecoins passing the Robinhood check (flagged very high risk). */
export function allowedMemes(o: MerklOpportunity, ctx: VetContext): MerklToken[] {
  const all = [...o.tokens, ...o.campaigns.map((c) => c.rewardToken)];
  return all.filter((t) => isMeme(t) && robinhoodMemeCheck(t, ctx) === null);
}

// ─── Reward price ────────────────────────────────────────────────────────────

export interface PriceCheck {
  /** Price usable for dollars. */
  ok: boolean;
  reason: Reason | null;
  price: number | null;
  market: TokenMarket | null;
  /** Liquidity is known (DEX data) or presumed deep (stable / major at the right price). */
  depth: 'deep' | 'known' | 'unknown';
  /** Why confidence is lower even when the price is usable. */
  caveats: string[];
}

/** Can this reward token be turned into dollars at today's price? */
export function checkRewardPrice(t: MerklToken, ctx: VetContext): PriceCheck {
  const market = marketOf(t, ctx) ?? null;
  const out = (ok: boolean, reason: Reason | null, depth: PriceCheck['depth'] = 'unknown', caveats: string[] = []): PriceCheck => ({ ok, reason, price: ok ? t.price : null, market, depth, caveats });
  if (t.type === 'POINT') return out(false, r('point', 'پوینت؛ قیمت ندارد'));
  if (t.type === 'PRETGE') return out(false, r('pretge', 'توکن عرضه‌نشده (پیش از TGE)؛ قیمت بازار ندارد'));
  if (t.price === null) return out(false, r('no-price', `توکن پاداش «${t.symbol}» قیمت معتبر ندارد`));
  // A verified dollar stablecoin at its peg: the peg is the price, whatever Merkl's source label says.
  if (t.verified && tokenClass(t) === 'usd' && Math.abs(t.price - 1) <= 0.02) {
    const oldSource = (t.priceSource && /deprecated/i.test(t.priceSource)) || t.priceAt === null || ctx.now - t.priceAt > RULES.priceMaxAgeH * HOUR;
    return out(true, null, 'deep', oldSource ? [`قیمت ${t.symbol} بر پایه‌ی برابری با دلار؛ منبع قیمت Merkl به‌روز نیست`] : []);
  }
  if (t.priceSource && /deprecated/i.test(t.priceSource)) return out(false, r('price-deprecated', `منبع قیمت «${t.symbol}» منسوخ است`));
  if (t.priceAt === null || ctx.now - t.priceAt > RULES.priceMaxAgeH * HOUR) return out(false, r('price-stale', `قیمت «${t.symbol}» قدیمی است`));
  const sus = suspicion(t, ctx);
  if (sus) return out(false, sus);
  if (isMeme(t)) {
    const m = robinhoodMemeCheck(t, ctx);
    if (m) return out(false, m);
  }
  const cls = tokenClass(t);
  if (cls !== 'other' && t.verified) return out(true, null, 'deep');
  if (market) {
    if (market.dexPrice !== null && Math.abs(t.price / market.dexPrice - 1) > RULES.maxPriceGap) return out(false, r('price-gap', `قیمت Merkl برای «${t.symbol}» با بازار DEX هم‌خوان نیست`));
    if (market.liquidityUsd < RULES.minRewardLiquidity) return out(false, r('thin', `نقدشوندگی «${t.symbol}» کمتر از حد لازم است`));
    return out(true, null, 'known', t.verified ? [] : ['توکن پاداش در Merkl تأییدنشده؛ فقط بازار DEX آن را تأیید می‌کند']);
  }
  if (!t.verified) return out(false, r('unverified', `توکن پاداش «${t.symbol}» تأییدنشده و بدون بازار قابل‌بررسی`));
  const covered = ctx.marketChains.has(t.chainId);
  return out(true, null, 'unknown', [covered ? `بازار DEX برای «${t.symbol}» پیدا نشد` : `نقدشوندگی «${t.symbol}» در این شبکه قابل‌بررسی نیست`]);
}

// ─── Opportunity gates ───────────────────────────────────────────────────────

/**
 * Hard gates for listing an opportunity at all (both views). Returns the first
 * failing reason, or null when the opportunity is admissible.
 */
export function gate(o: MerklOpportunity, ctx: VetContext): Reason | null {
  const now = ctx.now;
  const live = o.campaigns.filter((c) => c.start <= now && c.end > now);
  if (!live.length) return r('no-campaign', 'کمپین فعالی ندارد');
  if (o.tags.includes('merkl-test')) return r('test', 'فرصت آزمایشی Merkl');
  if (!o.chain.id || !o.identifier) return r('identity', 'شبکه یا شناسه‌ی قرارداد مشخص نیست');
  const deposit = o.tokens.filter((t) => t.type === 'TOKEN' && t.symbol !== '?');
  if (!deposit.length) return r('no-asset', 'دارایی ورودی قابل‌شناسایی ندارد');
  if (!o.depositUrl && !o.protocol?.url) return r('no-link', 'مسیر ورود رسمی (لینک پروتکل) ندارد');
  const recordAt = Math.max(o.aprAt ?? 0, o.tvlAt ?? 0);
  if (!recordAt || now - recordAt > RULES.recordMaxAgeH * HOUR) return r('stale', 'داده‌ی APR و TVL قدیمی است');
  if (o.apr > RULES.absurdApr) return r('absurd-apr', 'APR غیرعادی؛ احتمال خطای داده');
  if (o.tvl < RULES.minTvl) return r('low-tvl', 'TVL بسیار کم؛ پاداش ناپایدار');
  if (live.every((c) => (c.end - now) / DAY < RULES.minDaysLeft)) return r('ending', 'کمتر از یک روز تا پایان کمپین');
  for (const t of deposit) {
    const sus = suspicion(t, ctx);
    if (sus) return sus;
    if (isMeme(t)) {
      const m = robinhoodMemeCheck(t, ctx);
      if (m) return m;
    }
  }
  for (const c of live) {
    const t = c.rewardToken;
    if (t.type !== 'TOKEN') continue;
    const sus = suspicion(t, ctx);
    if (sus) return sus;
    if (isMeme(t)) {
      const m = robinhoodMemeCheck(t, ctx);
      if (m) return m;
    }
  }
  if (live.every((c) => restrictions(c).length > 0)) return r('restricted', `شرط دسترسی: ${restrictions(live[0]).join('، ')}`);
  return null;
}

/** Stable identity for de-duplication: the same market reached via a program and a protocol is one row. */
export const marketKey = (o: MerklOpportunity) => `${o.chain.id}:${o.type}:${o.identifier.toLowerCase()}`;

/** Unique by id and by market identity; the copy with more live campaigns wins. */
export function dedupe(list: MerklOpportunity[]): MerklOpportunity[] {
  const byKey = new Map<string, MerklOpportunity>();
  const ids = new Set<string>();
  for (const o of list) {
    if (ids.has(o.id)) continue;
    ids.add(o.id);
    const k = marketKey(o);
    const prev = byKey.get(k);
    if (!prev || o.campaigns.length > prev.campaigns.length) byKey.set(k, o);
  }
  return [...byKey.values()];
}
