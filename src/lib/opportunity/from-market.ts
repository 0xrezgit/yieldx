import type { MarketListing } from '../../types/market';
import type { DataQuality, Opportunity } from '../../types/opportunity';
import type { ProtocolId } from '../../types/protocol';
import { protocolIdentity } from '../registry/identity';
import { networkByName } from '../registry/networks';

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
    // An AMM has no deposit cap; its depth shows up as price impact instead.
    capacity: { depositRemainingUsd: null, withdrawableNowUsd: null },
    exit: { type: 'secondary', note: 'فروش PT در استخر پیش از سررسید، یا بازخرید در سررسید' },
    rewards: [],
    quality: m.expired ? 'insufficient' : quality,
    sources: [{ name: identity.name, url: null, fetchedAt, sourceUpdatedAt: updated }],
    ptToken: m.ptToken ?? null,
    poolLiquidityUsd: m.liquidity !== null && Number.isFinite(m.liquidity) && m.liquidity > 0 ? m.liquidity : null,
    icon: m.icon ?? null,
  };
}

/** Unknown costs every PT entry has today (the list gives no executable quote). */
export const PT_UNKNOWN_COSTS = ['کارمزد سواپ و اثر قیمت خرید PT (بدون quote)'];
