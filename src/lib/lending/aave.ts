import lending from '../../config/lending.json';
import type { Opportunity, RewardStream } from '../../types/opportunity';
import { networkByChainId } from '../registry/networks';
import { isObject, postGraphql } from '../protocols/base';
import { kinkedBorrowCurve, kinkedSupplyCurve } from '../opportunity/curve';
import type { HistoryPoints } from './history';

/**
 * Aave V4 — supplying to a Spoke reserve (liquidity sits in the Hub), from AaveKit,
 * Aave's official GraphQL API. Endpoint and fields from the official V4 SDK
 * (github.com/aave/aave-v4-sdk, packages/graphql/schema.graphql; production
 * backend https://api.aave.com/graphql in @aave/client):
 * - PercentNumber.value: «1.0 represents 100%».
 * - ReserveSummary.supplyApy: APY; HubAssetSettings.liquidityFee is «already
 *   deducted from supplyApy».
 * - HubAssetSettings: two-slope rate model (base, slope below / above the optimal
 *   utilization) → the rate after the user's deposit.
 * - HubAssetSummary.availableLiquidity: what can be withdrawn now (Hub-wide).
 * - MerklSupplyReward: extraApy with start/end dates and eligibility criteria.
 * - BigDecimal values arrive as strings.
 */

const CFG = lending.aave;
const num = (x: unknown): number | null => {
  const n = typeof x === 'string' ? Number(x) : typeof x === 'number' ? x : NaN;
  return Number.isFinite(n) ? n : null;
};
const pctOf = (p: { value: unknown } | null | undefined) => {
  const v = num(p?.value);
  return v === null ? null : v * 100;
};

interface Amount {
  amount?: { value: string } | null;
  exchange: { value: string } | null;
}
interface RawToken {
  address: string;
  info: { symbol: string; icon?: string | null } | null;
}
type RawReward =
  | { __typename: 'MerklSupplyReward'; id: string; endDate: string; extraApy: { value: string }; payoutToken: RawToken; criteria: { text?: string }[] }
  | { __typename: 'SupplyPointsReward'; id: string; name: string; endDate: string | null }
  | { __typename: string; id?: string };

export interface RawAaveReserve {
  id: string;
  chain: { chainId: number; name: string };
  spoke: { id: string; name: string; address: string };
  status: { active: boolean; frozen: boolean; paused: boolean };
  canSupply: boolean;
  canBorrow?: boolean;
  canUseAsCollateral?: boolean;
  summary: { supplied: Amount; supplyApy: { value: string }; borrowApy?: { value: string }; underlyingApy?: { value: string } | null; borrowable?: Amount; rewards: RawReward[] };
  settings: { supplyCap: Amount; collateralFactor?: { value: string }; collateral?: boolean };
  asset: {
    underlying: RawToken;
    hub: { id: string; name: string; address: string };
    summary: { supplied: Amount; borrowed: Amount; availableLiquidity: Amount };
    settings: {
      liquidityFee: { value: string };
      optimalUtilizationRate: { value: string };
      baseBorrowRate: { value: string };
      slopeBelowOptimal: { value: string };
      slopeAboveOptimal: { value: string };
    };
  };
}

const AMOUNT = 'amount { value } exchange { value }';
const TOKEN = 'address info { symbol icon }';

export const AAVE_CHAINS_QUERY = `query YieldXChains { chains(request: { query: { filter: MAINNET_ONLY } }) { chainId } }`;

export const AAVE_RESERVES_QUERY = `query YieldXReserves($chainIds: [ChainId!]) {
  reserves(request: { query: { chainIds: $chainIds }, filter: ALL }) {
    id
    chain { chainId name }
    spoke { id name address }
    status { active frozen paused }
    canSupply
    canBorrow
    canUseAsCollateral
    summary {
      supplied { ${AMOUNT} }
      borrowable { ${AMOUNT} }
      supplyApy { value }
      borrowApy { value }
      underlyingApy { value }
      rewards {
        __typename
        ... on MerklSupplyReward { id endDate extraApy { value } payoutToken { ${TOKEN} } criteria { ... on MerklGenericCriteria { text } } }
        ... on SupplyPointsReward { id name endDate }
      }
    }
    settings { supplyCap { ${AMOUNT} } collateralFactor { value } collateral }
    asset {
      underlying { ${TOKEN} }
      hub { id name address }
      summary { supplied { ${AMOUNT} } borrowed { ${AMOUNT} } availableLiquidity { ${AMOUNT} } }
      settings { liquidityFee { value } optimalUtilizationRate { value } baseBorrowRate { value } slopeBelowOptimal { value } slopeAboveOptimal { value } }
    }
  }
}`;

const isChains = (b: unknown): b is { chains: { chainId: number }[] } => isObject<{ chains: unknown }>(b) && Array.isArray(b.chains);
const isReserves = (b: unknown): b is { reserves: RawAaveReserve[] } => isObject<{ reserves: unknown }>(b) && Array.isArray(b.reserves);

export async function fetchAave(): Promise<RawAaveReserve[]> {
  const { chains } = await postGraphql(CFG.name, CFG.graphql, AAVE_CHAINS_QUERY, {}, isChains);
  const chainIds = chains.map((c) => c.chainId).filter((id) => Number.isInteger(id) && id > 0);
  if (!chainIds.length) return [];
  const { reserves } = await postGraphql(CFG.name, CFG.graphql, AAVE_RESERVES_QUERY, { chainIds }, isReserves);
  return reserves;
}

function rewards(list: RawReward[], chainId: number): RewardStream[] {
  const chain = networkByChainId(chainId).key;
  return list.flatMap((r): RewardStream[] => {
    if (r.__typename === 'MerklSupplyReward' && 'extraApy' in r) {
      const criteria = (r.criteria ?? []).map((c) => c.text).filter((t): t is string => !!t);
      return [
        {
          key: `aave:${r.id}`,
          source: 'protocol',
          kind: 'token',
          token: { symbol: r.payoutToken?.info?.symbol ?? null, address: r.payoutToken?.address ?? null, chain },
          aprUsd: pctOf(r.extraApy),
          endsAt: r.endDate ?? null,
          // Aave lists the eligibility rules; a reward with any is not counted automatically.
          conditional: criteria.length > 0,
          vesting: false,
        },
      ];
    }
    if (r.__typename === 'SupplyPointsReward' && 'name' in r) {
      return [{ key: `aave:${r.id}`, source: 'protocol', kind: 'points', token: null, aprUsd: null, endsAt: r.endDate ?? null, conditional: false, vesting: false }];
    }
    return [];
  });
}

export function aaveReserve(r: RawAaveReserve, fetchedAt: string): Opportunity | null {
  if (!r?.chain?.chainId || !r.asset?.underlying?.address || !r.spoke?.address) return null;
  const network = networkByChainId(r.chain.chainId);
  const symbol = r.asset.underlying.info?.symbol ?? null;
  const supplied = num(r.summary?.supplied?.exchange?.value);
  const cap = num(r.settings?.supplyCap?.exchange?.value);
  const hubSupplied = num(r.asset.summary?.supplied?.exchange?.value);
  const hubBorrowed = num(r.asset.summary?.borrowed?.exchange?.value);
  const s = r.asset.settings;
  const points = s
    ? kinkedSupplyCurve({
        base: num(s.baseBorrowRate?.value) ?? NaN,
        slope1: num(s.slopeBelowOptimal?.value) ?? NaN,
        slope2: num(s.slopeAboveOptimal?.value) ?? NaN,
        optimal: num(s.optimalUtilizationRate?.value) ?? NaN,
        fee: num(s.liquidityFee?.value) ?? NaN,
      })
    : [];
  const halted = !r.status?.active || r.status.frozen || r.status.paused;
  const blocked = halted || !r.canSupply;
  const cf = num(r.settings?.collateralFactor?.value);
  const underlying = pctOf(r.summary?.underlyingApy);
  const borrowPct = pctOf(r.summary?.borrowApy);
  const borrowPoints = s
    ? kinkedBorrowCurve({ base: num(s.baseBorrowRate?.value) ?? NaN, slope1: num(s.slopeBelowOptimal?.value) ?? NaN, slope2: num(s.slopeAboveOptimal?.value) ?? NaN, optimal: num(s.optimalUtilizationRate?.value) ?? NaN })
    : [];
  const rate = pctOf(r.summary?.supplyApy);
  const notes: string[] = [`Hub: ${r.asset.hub?.name ?? '—'} · Spoke: ${r.spoke.name}`];
  if (cap === 0) notes.push('سقف سپرده‌ی این reserve صفر گزارش شده؛ معنای آن در مستندات روشن نیست و ظرفیت نامعلوم در نظر گرفته شد.');
  return {
    key: `aave:${network.key}:${r.spoke.address.toLowerCase()}:${r.asset.underlying.address.toLowerCase()}:supply`,
    // A reserve you can only borrow from feeds loops and the borrow comparison, never the earn list.
    family: r.canSupply ? 'lend' : 'borrow',
    protocol: { id: 'aave', version: 'v4', name: 'Aave' },
    chain: network.key,
    market: { id: r.id, address: r.spoke.address, name: `${symbol ?? '—'} · ${r.spoke.name}` },
    assets: { deposit: [{ symbol, address: r.asset.underlying.address }] },
    rate: { value: rate, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: null },
    maturity: null,
    capacity: {
      depositRemainingUsd: cap !== null && cap > 0 && supplied !== null ? Math.max(0, cap - supplied) : null,
      withdrawableNowUsd: num(r.asset.summary?.availableLiquidity?.exchange?.value),
    },
    exit: { type: 'instant', note: 'برداشت تا سقف نقدینگی موجود در Hub.' },
    rewards: rewards(r.summary?.rewards ?? [], r.chain.chainId),
    supplyCurve: hubSupplied !== null && hubBorrowed !== null && points.length ? { suppliedUsd: hubSupplied, borrowedUsd: hubBorrowed, points, source: 'پارامترهای نرخ Hub در Aave' } : null,
    borrow:
      r.canBorrow && !halted
        ? {
            ratePct: borrowPct,
            curve: hubSupplied !== null && hubBorrowed !== null && borrowPoints.length ? { suppliedUsd: hubSupplied, borrowedUsd: hubBorrowed, points: borrowPoints, source: 'پارامترهای نرخ Hub در Aave' } : null,
            availableUsd: num(r.summary?.borrowable?.exchange?.value) ?? num(r.asset.summary?.availableLiquidity?.exchange?.value),
            // Filled with the Spoke's collateral reserves by normalizeAave.
            collateral: [],
            metric: 'hf',
            premiumUnknown: true,
          }
        : null,
    assetYield: underlying !== null && underlying > 0 ? { pct: underlying, kind: 'apy', source: 'بازده خود دارایی (underlyingApy در AaveKit)' } : null,
    asCollateral: r.canUseAsCollateral && r.settings?.collateral !== false && cf !== null && cf > 0 && cf < 1 && !halted ? { maxLtv: cf, supplyPct: rate } : null,
    risk: { paused: blocked, incidents: [] },
    quality: rate === null ? 'insufficient' : 'current',
    sources: [{ name: 'AaveKit API', url: CFG.graphql, fetchedAt, sourceUpdatedAt: null }],
    notes,
    url: CFG.app,
    icon: r.asset.underlying.info?.icon ?? null,
  };
}

/**
 * Every reserve in the shared model; each borrowable reserve lists the collateral
 * accepted on the same Spoke (V4 borrows against the Spoke position as a whole).
 */
export function normalizeAave(list: RawAaveReserve[], fetchedAt: string): Opportunity[] {
  const opps = list.map((r) => aaveReserve(r, fetchedAt)).filter((o): o is Opportunity => o !== null);
  const bySpoke = new Map<string, Opportunity[]>();
  for (const o of opps) bySpoke.set(`${o.chain}:${o.market.address}`, [...(bySpoke.get(`${o.chain}:${o.market.address}`) ?? []), o]);
  return opps.map((o) => {
    if (!o.borrow) return o;
    const collateral = (bySpoke.get(`${o.chain}:${o.market.address}`) ?? [])
      .filter((c) => c.asCollateral && c.assets.deposit[0]?.address?.toLowerCase() !== o.assets.deposit[0]?.address?.toLowerCase())
      .map((c) => ({ token: c.assets.deposit[0], maxLtv: c.asCollateral!.maxLtv, yield: c.assetYield ?? null, supplyPct: c.asCollateral!.supplyPct }));
    return { ...o, borrow: { ...o.borrow, collateral } };
  });
}

// ─── Daily history (robust rate) ─────────────────────────────────────────────

/** Reserves asked per request (one aliased field each); the API allows 10 top-level aliases. */
const HISTORY_BATCH = 10;

/** Daily supply APY (%) per reserve, without rewards; six months is daily. */
export async function fetchAaveHistory(list: Opportunity[]): Promise<Map<string, HistoryPoints>> {
  const out = new Map<string, HistoryPoints>();
  for (let i = 0; i < list.length; i += HISTORY_BATCH) {
    const batch = list.slice(i, i + HISTORY_BATCH);
    const fields = batch.map((o, j) => `r${j}: supplyApyHistory(request: { reserve: ${JSON.stringify(o.market.id)}, window: LAST_SIX_MONTHS, includeRewards: false }) { date avgRate { value } }`).join(' ');
    const d = await postGraphql(CFG.name, CFG.graphql, `query YieldXHistory { ${fields} }`, {}, (b): b is Record<string, { date?: string; avgRate?: { value?: string | number } }[]> => isObject(b));
    batch.forEach((o, j) => {
      const rows = d[`r${j}`];
      if (!Array.isArray(rows)) return;
      out.set(
        o.key,
        rows.map((r) => {
          const v = Number(r.avgRate?.value);
          return { t: Date.parse(r.date ?? ''), v: Number.isFinite(v) ? v * 100 : null };
        }),
      );
    });
  }
  return out;
}
