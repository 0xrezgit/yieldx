import lending from '../../config/lending.json';
import type { DataQuality, Opportunity, RewardStream } from '../../types/opportunity';
import { networkByChainId } from '../registry/networks';
import { isObject, postGraphql } from '../protocols/base';
import { formatPercent } from '../utils/formatting';
import { morphoLink } from '../market/links';
import { HISTORY_DAYS } from '../opportunity/robust-rate';
import type { HistoryPoints } from './history';

/**
 * Morpho — variable-rate supply to Morpho Blue markets and deposits into vaults
 * (V1 «MetaMorpho» and V2), from Morpho's public GraphQL API.
 *
 * Field meanings, from the official schema (@morpho-org/blue-api-sdk, types.d.ts):
 * - Every APY/APR/fee is a fraction (0.05 = 5%).
 * - Market `state.supplyApy`: instantaneous supply APY, excluding rewards; the
 *   market fee is taken from borrower interest before it reaches suppliers.
 * - Market `currentIrmCurve`: supply APY at each utilization (for the rate after
 *   the user's deposit).
 * - Market `state.liquidityAssetsUsd`: what can be borrowed — and so withdrawn — now.
 * - Vault V1 `state.netApyExcludingRewards`: «instantaneous vault APY excluding rewards,
 *   after deducting the performance fee». `liquidity.usd`: «withdrawable liquidity».
 *   Its rewards are `state.allRewards` (same shape as a market's `state.rewards`).
 * - Vault V2 `avgNetApy`: realized from share price, «after fees, with rewards»;
 *   `liquidityUsd`: liquidity adapter + idle assets.
 * - Reward `supplyApr`: APR, reported without a campaign end date.
 * - Market `state.weeklyBorrowApy`: the borrow APY averaged over 7 days (loops use the
 *   higher of it and today's, so one cheap moment does not make a loop look good).
 * - A market is identified by `marketId` (the on-chain id) and filtered with `listed`.
 *
 * Schema renames seen live on 2026-10-01 (the old names now fail validation):
 * `uniqueKey` → `marketId`, filter `whitelisted` → `listed`, vault state
 * `netApyWithoutRewards` → `netApyExcludingRewards`, vault state `rewards` → `allRewards`.
 */

const CFG = lending.morpho;
const pct = (fraction: number | null | undefined) => (fraction === null || fraction === undefined || !Number.isFinite(fraction) ? null : fraction * 100);
const finite = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const isoFromUnix = (s: unknown): string | null => {
  const n = typeof s === 'string' ? Number(s) : typeof s === 'number' ? s : NaN;
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString() : null;
};

// ─── Raw API shapes (only the fields queried) ───────────────────────────────

interface RawAsset {
  address: string;
  symbol: string;
  logoURI?: string | null;
  /** The asset's own yield (APR, fraction), e.g. staking; null when none. */
  yield?: { apr: number } | null;
  chain?: { id: number } | null;
}
interface RawWarning {
  type: string;
  level: 'RED' | 'YELLOW' | 'GREEN';
}
interface RawReward {
  asset: RawAsset;
  supplyApr: number | null;
}
export interface RawMorphoMarket {
  marketId: string;
  lltv: string;
  loanAsset: RawAsset;
  collateralAsset: RawAsset | null;
  warnings: RawWarning[];
  currentIrmCurve: { utilization: number; supplyApy: number; borrowApy?: number }[] | null;
  state: {
    supplyApy: number;
    borrowApy?: number;
    weeklyBorrowApy?: number | null;
    weeklySupplyApy?: number | null;
    dailySupplyApy?: number | null;
    supplyAssetsUsd: number | null;
    borrowAssetsUsd: number | null;
    liquidityAssetsUsd: number | null;
    fee: number;
    timestamp: string | number;
    rewards: RawReward[];
  } | null;
}
interface RawPoint {
  x: number;
  y: number | null;
}
export interface RawMorphoVault {
  address: string;
  name: string;
  asset: RawAsset;
  chain: { id: number };
  warnings: RawWarning[];
  liquidity: { usd: number } | null;
  state: {
    netApyExcludingRewards: number;
    /** The same, averaged over the last 7 days and the last day. */
    avgNetApyExcludingRewards?: number | null;
    dayNetApyExcludingRewards?: number | null;
    fee: number;
    totalAssetsUsd: number | null;
    timestamp: string | number;
    allRewards: RawReward[];
  } | null;
}
export interface RawMorphoVaultV2 {
  address: string;
  name: string;
  asset: RawAsset;
  chain: { id: number };
  warnings: RawWarning[];
  liquidityUsd: number | null;
  totalAssetsUsd: number | null;
  avgNetApy: number | null;
  performanceFee: number;
  managementFee: number;
  rewards: RawReward[];
}
export interface MorphoData {
  markets: { items: RawMorphoMarket[] | null };
  vaults: { items: RawMorphoVault[] | null };
  vaultV2s: { items: RawMorphoVaultV2[] | null };
}

const ASSET = 'address symbol logoURI chain { id } yield { apr }';
const REWARD_FIELDS = `asset { ${ASSET} } supplyApr`;
const REWARD = `rewards { ${REWARD_FIELDS} }`;

export const MORPHO_QUERY = `query YieldXLending($chains: [Int!], $minUsd: Float, $first: Int, $skip: Int) {
  markets(first: $first, skip: $skip, orderBy: SupplyAssetsUsd, orderDirection: Desc, where: { chainId_in: $chains, listed: true, supplyAssetsUsd_gte: $minUsd }) {
    items {
      marketId lltv
      loanAsset { ${ASSET} }
      collateralAsset { ${ASSET} }
      warnings { type level }
      currentIrmCurve { utilization supplyApy borrowApy }
      state { supplyApy dailySupplyApy weeklySupplyApy borrowApy weeklyBorrowApy supplyAssetsUsd borrowAssetsUsd liquidityAssetsUsd fee timestamp ${REWARD} }
    }
  }
  vaults(first: $first, skip: $skip, orderBy: TotalAssetsUsd, orderDirection: Desc, where: { chainId_in: $chains, listed: true, totalAssetsUsd_gte: $minUsd }) {
    items {
      address name
      asset { ${ASSET} }
      chain { id }
      warnings { type level }
      liquidity { usd }
      state { netApyExcludingRewards avgNetApyExcludingRewards(lookback: SEVEN_DAYS) dayNetApyExcludingRewards: avgNetApyExcludingRewards(lookback: ONE_DAY) fee totalAssetsUsd timestamp allRewards { ${REWARD_FIELDS} } }
    }
  }
  vaultV2s(first: $first, skip: $skip, where: { chainId_in: $chains, listed: true }) {
    items {
      address name
      asset { ${ASSET} }
      chain { id }
      warnings { type level }
      liquidityUsd totalAssetsUsd
      avgNetApy(lookback: SEVEN_DAYS)
      performanceFee managementFee
      ${REWARD}
    }
  }
}`;

const isMorphoData = (b: unknown): b is MorphoData =>
  isObject<MorphoData>(b) && isObject(b.markets) && isObject(b.vaults) && isObject(b.vaultV2s);

/** Pages until every list is exhausted (or `maxPages`), so new markets are never cut off by a fixed first-N. */
export async function fetchMorpho(): Promise<MorphoData> {
  const out: MorphoData = { markets: { items: [] }, vaults: { items: [] }, vaultV2s: { items: [] } };
  for (let page = 0; page < CFG.maxPages; page++) {
    const d = await postGraphql(CFG.name, CFG.graphql, MORPHO_QUERY, { chains: CFG.chains, minUsd: CFG.minSupplyUsd, first: CFG.pageSize, skip: page * CFG.pageSize }, isMorphoData);
    const lists = [d.markets.items ?? [], d.vaults.items ?? [], d.vaultV2s.items ?? []];
    out.markets.items!.push(...(lists[0] as RawMorphoMarket[]));
    out.vaults.items!.push(...(lists[1] as RawMorphoVault[]));
    out.vaultV2s.items!.push(...(lists[2] as RawMorphoVaultV2[]));
    if (lists.every((l) => l.length < CFG.pageSize)) break;
  }
  return out;
}

// ─── Normalisation ───────────────────────────────────────────────────────────

/** An asset's own yield as Morpho reports it (APR). */
export const assetYield = (a: RawAsset | null | undefined) => {
  const y = pct(a?.yield?.apr);
  return y !== null && y > 0 ? { pct: y, kind: 'apr' as const, source: 'بازده خود دارایی (Morpho API)' } : null;
};

/** Morpho rewards come without an end date: listed, but not counted in dollars until linked to their campaign. */
function rewards(list: RawReward[] | undefined, owner: string, chainId: number): RewardStream[] {
  return (list ?? [])
    .filter((r) => r.asset?.address && pct(r.supplyApr) !== null && (r.supplyApr ?? 0) > 0)
    .map((r) => ({
      key: `morpho:${chainId}:${owner.toLowerCase()}:${r.asset.address.toLowerCase()}`,
      source: 'protocol' as const,
      kind: 'token' as const,
      token: { symbol: r.asset.symbol ?? null, address: r.asset.address, chain: networkByChainId(chainId).key },
      aprUsd: pct(r.supplyApr),
      endsAt: null,
      conditional: false,
      vesting: false,
    }));
}

const warningQuality = (w: RawWarning[] | undefined): { quality: DataQuality | null; notes: string[] } => {
  const red = (w ?? []).filter((x) => x.level === 'RED');
  const yellow = (w ?? []).filter((x) => x.level === 'YELLOW');
  const notes = [...red, ...yellow].map((x) => `هشدار Morpho (${x.level === 'RED' ? 'قرمز' : 'زرد'}): ${x.type}`);
  return { quality: red.length ? 'insufficient' : yellow.length ? 'partial' : null, notes };
};

export function morphoMarket(m: RawMorphoMarket, fetchedAt: string): Opportunity | null {
  const s = m.state;
  const chainId = m.loanAsset?.chain?.id;
  if (!s || !chainId || !m.marketId || !m.loanAsset?.address) return null;
  const network = networkByChainId(chainId);
  const w = warningQuality(m.warnings);
  const supplied = finite(s.supplyAssetsUsd);
  const borrowed = finite(s.borrowAssetsUsd);
  const curve = (m.currentIrmCurve ?? []).filter((p) => Number.isFinite(p.utilization) && Number.isFinite(p.supplyApy)).sort((a, b) => a.utilization - b.utilization);
  // state.timestamp is the market's last on-chain update («Last update timestamp»), not when
  // the API computed the rate: a quiet market keeps an old timestamp while its rate is current.
  // The rate is therefore dated by our fetch; the on-chain time is kept as the source update.
  const onchainAt = isoFromUnix(s.timestamp);
  const at = fetchedAt;
  const collateral = m.collateralAsset?.symbol ?? '—';
  const lltv = Number(m.lltv) / 1e18;
  return {
    key: `morpho:${network.key}:${m.marketId.toLowerCase()}:supply`,
    family: 'lend',
    protocol: { id: 'morpho', version: 'blue', name: 'Morpho' },
    chain: network.key,
    market: { id: m.marketId, address: null, name: `${m.loanAsset.symbol} · وثیقه ${collateral}${Number.isFinite(lltv) && lltv > 0 ? ` · LLTV ${formatPercent(lltv * 100, 1)}` : ''}` },
    assets: {
      deposit: [{ symbol: m.loanAsset.symbol ?? null, address: m.loanAsset.address }],
      collateral: m.collateralAsset ? [{ symbol: m.collateralAsset.symbol ?? null, address: m.collateralAsset.address }] : [],
    },
    rate: { value: pct(s.supplyApy), kind: 'apy', feesIncluded: true, rewardsIncluded: false, at, avg7d: pct(s.weeklySupplyApy), avg1d: pct(s.dailySupplyApy) },
    maturity: null,
    // Blue markets have no supply cap.
    capacity: { depositRemainingUsd: null, uncapped: true, withdrawableNowUsd: finite(s.liquidityAssetsUsd) },
    exit: { type: 'instant', note: 'برداشت فقط تا سقف نقدینگی آزاد بازار؛ در استفاده‌ی نزدیک ۱۰۰٪ ممکن است موقتاً ممکن نباشد.' },
    rewards: rewards(s.rewards, m.marketId, chainId),
    supplyCurve: supplied !== null && borrowed !== null && curve.length > 1 ? { suppliedUsd: supplied, borrowedUsd: borrowed, points: curve.map((p) => ({ u: p.utilization, rate: p.supplyApy })), source: 'منحنی IRM گزارش‌شده‌ی Morpho' } : null,
    borrow:
      m.collateralAsset?.address && Number.isFinite(lltv) && lltv > 0
        ? {
            ratePct: pct(s.borrowApy),
            ratePct7d: pct(s.weeklyBorrowApy),
            curve:
              supplied !== null && borrowed !== null && curve.length > 1 && curve.every((p) => Number.isFinite(p.borrowApy))
                ? { suppliedUsd: supplied, borrowedUsd: borrowed, points: curve.map((p) => ({ u: p.utilization, rate: p.borrowApy as number })), source: 'منحنی IRM گزارش‌شده‌ی Morpho' }
                : null,
            availableUsd: finite(s.liquidityAssetsUsd),
            collateral: [{ token: { symbol: m.collateralAsset.symbol ?? null, address: m.collateralAsset.address }, maxLtv: lltv, yield: assetYield(m.collateralAsset) }],
            metric: 'ltv',
          }
        : null,
    assetYield: assetYield(m.loanAsset),
    risk: { oracle: null, curator: null, paused: false, incidents: w.notes },
    quality: w.quality ?? (pct(s.supplyApy) === null ? 'insufficient' : 'current'),
    sources: [{ name: 'Morpho API', url: CFG.graphql, fetchedAt, sourceUpdatedAt: onchainAt }],
    notes: w.notes,
    url: morphoLink(chainId, 'market', m.marketId)?.url ?? CFG.app,
    icon: m.loanAsset.logoURI ?? null,
  };
}

export function morphoVault(v: RawMorphoVault, fetchedAt: string): Opportunity | null {
  const s = v.state;
  if (!s || !v.chain?.id || !v.address) return null;
  const network = networkByChainId(v.chain.id);
  const w = warningQuality(v.warnings);
  // As for markets: the state timestamp is the last on-chain update, not the rate's age.
  const onchainAt = isoFromUnix(s.timestamp);
  const at = fetchedAt;
  return {
    key: `morpho:${network.key}:${v.address.toLowerCase()}:vault`,
    family: 'vault',
    protocol: { id: 'morpho', version: 'vault-v1', name: 'Morpho' },
    chain: network.key,
    market: { id: v.address, address: v.address, name: v.name },
    assets: { deposit: [{ symbol: v.asset?.symbol ?? null, address: v.asset?.address ?? null }] },
    rate: { value: pct(s.netApyExcludingRewards), kind: 'apy', feesIncluded: true, rewardsIncluded: false, fees: { performancePct: pct(s.fee) }, at, avg7d: pct(s.avgNetApyExcludingRewards), avg1d: pct(s.dayNetApyExcludingRewards) },
    maturity: null,
    // Room left is bounded by each market's cap in the vault; the API gives no single number.
    capacity: { depositRemainingUsd: null, withdrawableNowUsd: finite(v.liquidity?.usd) },
    exit: { type: 'instant', note: 'برداشت فوری تا سقف نقدینگی قابل برداشت خزانه.' },
    rewards: rewards(s.allRewards, v.address, v.chain.id),
    risk: { oracle: null, curator: null, paused: false, incidents: w.notes },
    quality: w.quality ?? (pct(s.netApyExcludingRewards) === null ? 'insufficient' : 'current'),
    sources: [{ name: 'Morpho API', url: CFG.graphql, fetchedAt, sourceUpdatedAt: onchainAt }],
    notes: ['بازده خزانه پس از کسر کارمزد عملکرد و بدون پاداش (netApyExcludingRewards)، نرخ لحظه‌ای.', ...w.notes],
    url: morphoLink(v.chain.id, 'vault', v.address)?.url ?? CFG.app,
    icon: v.asset?.logoURI ?? null,
  };
}

export function morphoVaultV2(v: RawMorphoVaultV2, fetchedAt: string): Opportunity | null {
  if (!v.chain?.id || !v.address) return null;
  const network = networkByChainId(v.chain.id);
  const w = warningQuality(v.warnings);
  const rewardApr = (v.rewards ?? []).reduce((a, r) => a + (finite(r.supplyApr) ?? 0), 0);
  // avgNetApy includes rewards: take them out so each reward is judged on its own (end date, price).
  const net = finite(v.avgNetApy);
  const base = net === null ? null : Math.max(0, net - rewardApr);
  return {
    key: `morpho:${network.key}:${v.address.toLowerCase()}:vault`,
    family: 'vault',
    protocol: { id: 'morpho', version: 'vault-v2', name: 'Morpho' },
    chain: network.key,
    market: { id: v.address, address: v.address, name: v.name },
    assets: { deposit: [{ symbol: v.asset?.symbol ?? null, address: v.asset?.address ?? null }] },
    rate: { value: pct(base), kind: 'apy', feesIncluded: true, rewardsIncluded: false, fees: { performancePct: pct(v.performanceFee), managementPct: pct(v.managementFee) }, at: null },
    maturity: null,
    capacity: { depositRemainingUsd: null, withdrawableNowUsd: finite(v.liquidityUsd) },
    exit: { type: 'instant', note: 'برداشت فوری تا نقدینگی adapter نقدینگی و دارایی بیکار؛ بیشتر از آن فقط با خروج غیرنقدی (forceDeallocate) و جریمه‌ی حداکثر ۲٪.' },
    rewards: rewards(v.rewards, v.address, v.chain.id),
    risk: { oracle: null, curator: null, paused: false, incidents: w.notes },
    quality: w.quality ?? (base === null ? 'insufficient' : 'partial'),
    sources: [{ name: 'Morpho API', url: CFG.graphql, fetchedAt, sourceUpdatedAt: null }],
    notes: [
      'بازده خزانه‌ی V2: میانگین تحقق‌یافته‌ی ۷ روز گذشته از قیمت سهم (پس از کارمزد)، منهای APR پاداش‌های گزارش‌شده؛ داده‌ی تاریخی است، نه نرخ لحظه‌ای.',
      ...w.notes,
    ],
    url: morphoLink(v.chain.id, 'vault', v.address)?.url ?? CFG.app,
    icon: v.asset?.logoURI ?? null,
  };
}

export function normalizeMorpho(d: MorphoData, fetchedAt: string): Opportunity[] {
  return [
    ...(d.markets.items ?? []).map((m) => morphoMarket(m, fetchedAt)),
    ...(d.vaults.items ?? []).map((v) => morphoVault(v, fetchedAt)),
    ...(d.vaultV2s.items ?? []).map((v) => morphoVaultV2(v, fetchedAt)),
  ].filter((o): o is Opportunity => o !== null);
}

// ─── Daily history (robust rate) ─────────────────────────────────────────────
// A separate query: with the history inside the main one, a page of 100 is over the
// API's complexity limit (3.6M of 1M). 50 items a page fit.

const HISTORY_PAGE = 50;
const SERIES = '(options: { startTimestamp: $since, interval: DAY }) { x y }';
const HISTORY_QUERIES = {
  markets: `query H($chains: [Int!], $minUsd: Float, $first: Int, $skip: Int, $since: Int) { markets(first: $first, skip: $skip, orderBy: SupplyAssetsUsd, orderDirection: Desc, where: { chainId_in: $chains, listed: true, supplyAssetsUsd_gte: $minUsd }) { items { marketId loanAsset { chain { id } } historicalState { supplyApy${SERIES} } } } }`,
  vaults: `query H($chains: [Int!], $minUsd: Float, $first: Int, $skip: Int, $since: Int) { vaults(first: $first, skip: $skip, orderBy: TotalAssetsUsd, orderDirection: Desc, where: { chainId_in: $chains, listed: true, totalAssetsUsd_gte: $minUsd }) { items { address chain { id } historicalState { netApyWithoutRewards${SERIES} } } } }`,
  vaultV2s: `query H($chains: [Int!], $first: Int, $skip: Int, $since: Int) { vaultV2s(first: $first, skip: $skip, where: { chainId_in: $chains, listed: true }) { items { address chain { id } historicalState { avgNetApy${SERIES} } } } }`,
} as const;

type HistoryItem = { marketId?: string; address?: string; chain?: { id: number }; loanAsset?: { chain?: { id: number } }; historicalState?: Record<string, RawPoint[] | null> | null };
const isHistoryPage = (b: unknown): b is Record<string, { items: HistoryItem[] | null }> => isObject(b);

const toPoints = (list: RawPoint[] | null | undefined): HistoryPoints => (list ?? []).map((p) => ({ t: p.x * 1000, v: p.y === null ? null : p.y * 100 }));

/**
 * Daily rates (%) of every listed market and vault, keyed like the opportunities. The
 * V2 series (`avgNetApy`) includes rewards; `withHistory`'s adjust takes them out.
 */
export async function fetchMorphoHistory(): Promise<Map<string, HistoryPoints>> {
  const out = new Map<string, HistoryPoints>();
  const since = Math.floor(Date.now() / 1000) - HISTORY_DAYS * 86_400;
  for (const [list, query] of Object.entries(HISTORY_QUERIES) as [keyof typeof HISTORY_QUERIES, string][]) {
    for (let page = 0; page < (CFG.maxPages * CFG.pageSize) / HISTORY_PAGE; page++) {
      const d = await postGraphql(CFG.name, CFG.graphql, query, { chains: CFG.chains, minUsd: CFG.minSupplyUsd, first: HISTORY_PAGE, skip: page * HISTORY_PAGE, since }, isHistoryPage);
      const items = d[list]?.items ?? [];
      for (const it of items) {
        const chainId = it.loanAsset?.chain?.id ?? it.chain?.id;
        const id = it.marketId ?? it.address;
        if (!chainId || !id) continue;
        const series = it.historicalState?.supplyApy ?? it.historicalState?.netApyWithoutRewards ?? it.historicalState?.avgNetApy;
        out.set(`morpho:${networkByChainId(chainId).key}:${id.toLowerCase()}:${list === 'markets' ? 'supply' : 'vault'}`, toPoints(series));
      }
      if (items.length < HISTORY_PAGE) break;
    }
  }
  return out;
}

/** V2 vault history includes rewards: today's reward APR (%) is taken out of each day — an approximation. */
export const morphoHistoryAdjust = (o: Opportunity, pctValue: number) =>
  o.protocol.version === 'vault-v2' ? Math.max(0, pctValue - o.rewards.reduce((a, r) => a + (r.aprUsd ?? 0), 0)) : pctValue;
