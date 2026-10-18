import type { MarketListing } from '../../types/market';
import type { DataQuality, Opportunity, RewardStream } from '../../types/opportunity';
import type { ProtocolId } from '../../types/protocol';
import { protocolIdentity } from '../registry/identity';
import { networkByName } from '../registry/networks';
import { listingLink } from '../market/links';
import { BASE_RATE_KIND, YT_YIELD_FEE_PCT } from '../calculators/trade';
import { tokenClass } from '../merkl/vetting';
import { isStable, stableTagged } from '../risk/opportunities';

/** PT/YT list data older than this is stale. */
const PT_MAX_AGE_MS = 6 * 3_600_000;

/**
 * A PT market from the existing adapters (Pendle, Exponent, Spectra) in the shared
 * model — read-only; the PT/YT screens keep using MarketListing as before.
 *
 * Buying PT and holding it to maturity earns the implied APY: it is the compounded
 * rate that turns today's PT price into 1 unit at maturity, so it is read as APY
 * The swap fee and the price impact of buying into the pool are not in the list;
 * they stay unknown costs and the amount must stay small against the pool (policy.ts).
 */
export function ptOpportunity(protocol: ProtocolId, m: MarketListing, fetchedAt: string, now = Date.now()): Opportunity {
  const network = networkByName(m.chain);
  const updated = m.sourceUpdatedAt ?? null;
  const updatedMs = updated ? new Date(updated).getTime() : NaN;
  const quality: DataQuality = !Number.isFinite(m.impliedAPY)
    ? 'insufficient'
    : Number.isFinite(updatedMs) && now - updatedMs > PT_MAX_AGE_MS
      ? 'stale'
      : 'current';
  const identity = protocolIdentity(protocol);
  const address = m.id.includes('-') ? m.id.slice(m.id.indexOf('-') + 1) : m.id;

  return {
    key: `${protocol}:${network.key}:${address}:pt`,
    family: 'pt',
    protocol: { id: protocol, version: null, name: identity.name },
    chain: network.key,
    market: { id: m.id, address, name: m.name },
    assets: { deposit: m.asset ? [m.asset] : [] },
    rate: {
      value: Number.isFinite(m.impliedAPY) ? m.impliedAPY : null,
      kind: 'apy',
      // Implied APY is the pool's mid rate: the swap fee is charged on top when buying.
      feesIncluded: true,
      rewardsIncluded: false,
      at: updated,
    },
    maturity: m.maturity,
    ammFeeLn: m.ammFeeLn ?? null,
    ptRedeemFactor: m.ptRedeemFactor ?? null,
    // An AMM has no deposit cap; its depth shows up as price impact instead.
    capacity: { depositRemainingUsd: null, withdrawableNowUsd: null },
    exit: { type: 'secondary', note: 'فروش PT در استخر پیش از سررسید، یا بازخرید در سررسید' },
    rewards: [],
    quality: m.expired ? 'insufficient' : quality,
    sources: [{ name: identity.name, url: null, fetchedAt, sourceUpdatedAt: updated }],
    url: listingLink(protocol, m, 'pt').url,
    ptToken: m.ptToken ?? null,
    ptClass: ptClassOf(m),
    impliedHealth: m.impliedHealth ?? null,
    poolLiquidityUsd: m.liquidity !== null && Number.isFinite(m.liquidity) && m.liquidity > 0 ? m.liquidity : null,
    icon: m.icon ?? null,
    ...(stockTagged(m) ? { notes: [STOCK_NOTE(m.name)] } : {}),
  };
}

/** The protocol itself tags the market as a tokenized stock (Pendle: «stocks», e.g. Coinbase's GOOGLc, NVDAc). */
export const stockTagged = (m: Pick<MarketListing, 'categories'>) => m.categories.includes('stocks');

const STOCK_NOTE = (name: string) =>
  `سود به واحد سهم ${name} حساب شده و قیمت سهم ثابت فرض شده؛ ارزش دلاری اصل سرمایه با قیمت سهم بالا و پایین می‌رود و این نوسان در سود نیامده.`;

/** Above this PT share the LP's value follows PT prices (implied-rate moves), which this estimate does not model. */
export const LP_MAX_PT_SHARE = 0.1;

/**
 * The LP of a Pendle tokenized-stock market. Its pool is almost all SY, so an LP holds the
 * stock plus three incomes, none counted twice:
 *   rate     PT share × implied APY + SY share × base APY + swap-fee APY (in the stock's units);
 *   rewards  PENDLE emissions (Pendle's base, unboosted `pendleApy`) until maturity, diluted by
 *            the user's own deposit; external campaigns (Merkl) are linked by the LP address
 *            in the analysis — never Pendle's `lpRewardApy` or `aggregatedApy`, which already
 *            contain them.
 * Null when the pool is not known or its PT share is too large for this model.
 */
export function lpOpportunity(protocol: ProtocolId, m: MarketListing, fetchedAt: string, now = Date.now()): Opportunity | null {
  const p = m.pool;
  if (protocol !== 'pendle' || !p || !stockTagged(m) || !(p.ptShare >= 0 && p.ptShare <= LP_MAX_PT_SHARE) || !(m.impliedAPY >= 0)) return null;
  const pt = ptOpportunity(protocol, m, fetchedAt, now);
  const liq = pt.poolLiquidityUsd ?? null;
  const base = m.baseAPY !== null && Number.isFinite(m.baseAPY) ? Math.max(0, m.baseAPY) : 0;
  const rate = p.ptShare * m.impliedAPY + (1 - p.ptShare) * base + Math.max(0, p.swapFeePct);
  const rewards: RewardStream[] =
    p.pendlePct > 0 && liq !== null
      ? [
          {
            key: `pendle-emission:${m.id}`,
            source: 'protocol',
            kind: 'token',
            token: { symbol: 'PENDLE', address: null, chain: pt.chain },
            aprUsd: p.pendlePct,
            dailyUsd: (p.pendlePct / 100) * (liq / 365),
            eligibleTvlUsd: liq,
            endsAt: m.maturity,
            conditional: false,
            vesting: false,
          },
        ]
      : [];
  return {
    ...pt,
    key: pt.key.replace(/:pt$/, ':lp'),
    family: 'lp',
    market: { ...pt.market, name: `LP ${m.name}` },
    rate: { ...pt.rate, value: Number.isFinite(rate) ? rate : null, feesIncluded: true, rewardsIncluded: false },
    capacity: { depositRemainingUsd: null, uncapped: true, withdrawableNowUsd: null },
    exit: { type: 'secondary', note: 'خروج: برداشت نقدینگی از استخر (سهم کوچک PT پیش از سررسید فروخته و پس از آن بازخرید می‌شود)' },
    rewards,
    url: listingLink(protocol, m, 'lp').url,
    ptToken: null,
    pendleLp: { ptShare: p.ptShare },
    notes: [
      ...(pt.notes ?? []),
      `نرخ پایه‌ی LP: سهم PT (${(p.ptShare * 100).toFixed(1)}٪) × نرخ بازار + کارمزد سواپ؛ پاداش PENDLE با نرخ پایه (بدون boost) و تا سررسید؛ پاداش‌های بیرونی فقط از کمپین Merkl.`,
    ],
  };
}

/**
 * What a PT redeems into, as a class for pairing with a debt. Yield-bearing dollars
 * (sUSDS, reUSD, USD3…) are not in the plain-stablecoin list, so the underlying, then
 * the protocol's accounting asset (USDC for reUSD and USD3), then the protocol's own
 * stablecoin tag decide; a dollar name alone (sUSDat, apxUSD) counts, but unverified.
 */
export function ptClassOf(m: Pick<MarketListing, 'asset' | 'accountingSymbol' | 'categories' | 'name'>): Opportunity['ptClass'] {
  const a = tokenClass({ symbol: m.asset?.symbol ?? '' });
  const c = tokenClass({ symbol: m.accountingSymbol ?? '' });
  if (stockTagged(m)) return { class: 'stock', pegVerified: true };
  if (a === 'usd' || c === 'usd' || stableTagged(m)) return { class: 'usd', pegVerified: true };
  if (a === 'eth' || a === 'btc') return { class: a, pegVerified: true };
  if (c === 'eth' || c === 'btc') return { class: c, pegVerified: true };
  if (isStable(m)) return { class: 'usd', pegVerified: false };
  return null;
}

/**
 * The YT of the same market: buying it pays today's YT price for the underlying's
 * yield until maturity. The base yield is read the way each API publishes it —
 * Pendle and Exponent as APY, Spectra's IBT figure as APR (simple, the lower reading).
 * Null when the market gives no base yield: without it there is no estimate.
 */
export function ytOpportunity(protocol: ProtocolId, m: MarketListing, fetchedAt: string, now = Date.now()): Opportunity | null {
  if (m.baseAPY === null || !Number.isFinite(m.baseAPY) || !(m.impliedAPY > 0)) return null;
  const pt = ptOpportunity(protocol, m, fetchedAt, now);
  return {
    ...pt,
    key: pt.key.replace(/:pt$/, ':yt'),
    family: 'yt',
    market: { ...pt.market, name: `YT ${m.name}` },
    rate: { value: m.baseAPY, kind: BASE_RATE_KIND[protocol] ?? 'apy', feesIncluded: true, rewardsIncluded: false, at: pt.rate.at },
    exit: { type: 'maturity', note: 'در سررسید YT صفر می‌شود و بازده جمع‌شده دریافت می‌شود؛ فروش زودتر در استخر ممکن است.' },
    ptToken: null,
    url: listingLink(protocol, m, 'yt').url,
    yt: { impliedPct: m.impliedAPY, hasPoints: m.hasPoints, yieldFeePct: YT_YIELD_FEE_PCT[protocol] ?? null, health: m.baseHealth ?? null, levels: m.baseLevels ?? null },
  };
}

/** Unknown costs every PT entry has today (the list gives no executable quote). */
export const PT_UNKNOWN_COSTS = ['کارمزد سواپ و اثر قیمت خرید PT (بدون quote)'];
