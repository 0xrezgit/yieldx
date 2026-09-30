import lending from '../../config/lending.json';
import type { DataQuality, Opportunity, RewardStream } from '../../types/opportunity';
import { networkByChainId } from '../registry/networks';
import { isObject, postGraphql } from '../protocols/base';
import { formatPercent } from '../utils/formatting';

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
 * - Vault V1 `state.netApyWithoutRewards`: «excluding rewards, after deducting the
 *   performance fee». `liquidity.usd`: «withdrawable liquidity».
 * - Vault V2 `avgNetApy`: realized from share price, «after fees, with rewards»;
 *   `liquidityUsd`: liquidity adapter + idle assets.
 * - Reward `supplyApr`: APR, reported without a campaign end date.
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
  uniqueKey: string;
  lltv: string;
  loanAsset: RawAsset;
  collateralAsset: RawAsset | null;
  warnings: RawWarning[];
  currentIrmCurve: { utilization: number; supplyApy: number; borrowApy?: number }[] | null;
  state: {
    supplyApy: number;
    borrowApy?: number;
    supplyAssetsUsd: number | null;
    borrowAssetsUsd: number | null;
    liquidityAssetsUsd: number | null;
    fee: number;
    timestamp: string | number;
    rewards: RawReward[];
  } | null;
}
export interface RawMorphoVault {
  address: string;
  name: string;
  asset: RawAsset;
  chain: { id: number };
  warnings: RawWarning[];
  liquidity: { usd: number } | null;
  state: {
    netApyWithoutRewards: number;
    fee: number;
    totalAssetsUsd: number | null;
    timestamp: string | number;
    rewards: RawReward[];
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
const REWARD = `rewards { asset { ${ASSET} } supplyApr }`;

export const MORPHO_QUERY = `query YieldXLending($chains: [Int!], $minUsd: Float, $first: Int) {
  markets(first: $first, orderBy: SupplyAssetsUsd, orderDirection: Desc, where: { chainId_in: $chains, whitelisted: true, supplyAssetsUsd_gte: $minUsd }) {
    items {
      uniqueKey lltv
      loanAsset { ${ASSET} }
      collateralAsset { ${ASSET} }
      warnings { type level }
      currentIrmCurve { utilization supplyApy borrowApy }
      state { supplyApy borrowApy supplyAssetsUsd borrowAssetsUsd liquidityAssetsUsd fee timestamp ${REWARD} }
    }
  }
  vaults(first: $first, orderBy: TotalAssetsUsd, orderDirection: Desc, where: { chainId_in: $chains, whitelisted: true, totalAssetsUsd_gte: $minUsd }) {
    items {
      address name
      asset { ${ASSET} }
      chain { id }
      warnings { type level }
      liquidity { usd }
      state { netApyWithoutRewards fee totalAssetsUsd timestamp ${REWARD} }
    }
  }
  vaultV2s(first: $first, where: { chainId_in: $chains, whitelisted: true }) {
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

export async function fetchMorpho(): Promise<MorphoData> {
  return postGraphql(CFG.name, CFG.graphql, MORPHO_QUERY, { chains: CFG.chains, minUsd: CFG.minSupplyUsd, first: CFG.pageSize }, isMorphoData);
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
  if (!s || !chainId || !m.uniqueKey || !m.loanAsset?.address) return null;
  const network = networkByChainId(chainId);
  const w = warningQuality(m.warnings);
  const supplied = finite(s.supplyAssetsUsd);
  const borrowed = finite(s.borrowAssetsUsd);
  const curve = (m.currentIrmCurve ?? []).filter((p) => Number.isFinite(p.utilization) && Number.isFinite(p.supplyApy)).sort((a, b) => a.utilization - b.utilization);
  const at = isoFromUnix(s.timestamp);
  const collateral = m.collateralAsset?.symbol ?? '—';
  const lltv = Number(m.lltv) / 1e18;
  return {
    key: `morpho:${network.key}:${m.uniqueKey.toLowerCase()}:supply`,
    family: 'lend',
    protocol: { id: 'morpho', version: 'blue', name: 'Morpho' },
    chain: network.key,
    market: { id: m.uniqueKey, address: null, name: `${m.loanAsset.symbol} · وثیقه ${collateral}${Number.isFinite(lltv) && lltv > 0 ? ` · LLTV ${formatPercent(lltv * 100, 1)}` : ''}` },
    assets: {
      deposit: [{ symbol: m.loanAsset.symbol ?? null, address: m.loanAsset.address }],
      collateral: m.collateralAsset ? [{ symbol: m.collateralAsset.symbol ?? null, address: m.collateralAsset.address }] : [],
    },
    rate: { value: pct(s.supplyApy), kind: 'apy', feesIncluded: true, rewardsIncluded: false, at },
    maturity: null,
    // Blue markets have no supply cap.
    capacity: { depositRemainingUsd: null, uncapped: true, withdrawableNowUsd: finite(s.liquidityAssetsUsd) },
    exit: { type: 'instant', note: 'برداشت فقط تا سقف نقدینگی آزاد بازار؛ در استفاده‌ی نزدیک ۱۰۰٪ ممکن است موقتاً ممکن نباشد.' },
    rewards: rewards(s.rewards, m.uniqueKey, chainId),
    supplyCurve: supplied !== null && borrowed !== null && curve.length > 1 ? { suppliedUsd: supplied, borrowedUsd: borrowed, points: curve.map((p) => ({ u: p.utilization, rate: p.supplyApy })), source: 'منحنی IRM گزارش‌شده‌ی Morpho' } : null,
    borrow:
      m.collateralAsset?.address && Number.isFinite(lltv) && lltv > 0
        ? {
            ratePct: pct(s.borrowApy),
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
    sources: [{ name: 'Morpho API', url: CFG.graphql, fetchedAt, sourceUpdatedAt: at }],
    notes: w.notes,
    url: CFG.app,
    icon: m.loanAsset.logoURI ?? null,
  };
}

export function morphoVault(v: RawMorphoVault, fetchedAt: string): Opportunity | null {
  const s = v.state;
  if (!s || !v.chain?.id || !v.address) return null;
  const network = networkByChainId(v.chain.id);
  const w = warningQuality(v.warnings);
  const at = isoFromUnix(s.timestamp);
  return {
    key: `morpho:${network.key}:${v.address.toLowerCase()}:vault`,
    family: 'vault',
    protocol: { id: 'morpho', version: 'vault-v1', name: 'Morpho' },
    chain: network.key,
    market: { id: v.address, address: v.address, name: v.name },
    assets: { deposit: [{ symbol: v.asset?.symbol ?? null, address: v.asset?.address ?? null }] },
    rate: { value: pct(s.netApyWithoutRewards), kind: 'apy', feesIncluded: true, rewardsIncluded: false, fees: { performancePct: pct(s.fee) }, at },
    maturity: null,
    // Room left is bounded by each market's cap in the vault; the API gives no single number.
    capacity: { depositRemainingUsd: null, withdrawableNowUsd: finite(v.liquidity?.usd) },
    exit: { type: 'instant', note: 'برداشت فوری تا سقف نقدینگی قابل برداشت خزانه.' },
    rewards: rewards(s.rewards, v.address, v.chain.id),
    risk: { oracle: null, curator: null, paused: false, incidents: w.notes },
    quality: w.quality ?? (pct(s.netApyWithoutRewards) === null ? 'insufficient' : 'current'),
    sources: [{ name: 'Morpho API', url: CFG.graphql, fetchedAt, sourceUpdatedAt: at }],
    notes: ['بازده خزانه پس از کسر کارمزد عملکرد و بدون پاداش (netApyWithoutRewards)، نرخ لحظه‌ای.', ...w.notes],
    url: CFG.app,
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
    url: CFG.app,
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
