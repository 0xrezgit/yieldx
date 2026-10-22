import lending from '../../config/lending.json';
import type { BorrowSide, Opportunity } from '../../types/opportunity';
import { fetchJson, isObject, mapLimit } from '../protocols/base';
import { networkByChainId } from '../registry/networks';

/**
 * Euler (EVK vaults), from the public Euler Data API v3 (documented at /v3/openapi.json):
 *
 * - /v3/evk/vaults?chainId=: each vault with its asset, supply and borrow APY (percent),
 *   utilization, USD totals and Euler's own visibility verdict (`explorableLend`,
 *   `explorableBorrow`: deprecated or hidden vaults are left out, as Euler's app does).
 * - /v3/evk/vaults/{chainId}/{vault}/collaterals: what the vault lends against, with
 *   borrow and liquidation LTV (basis points) — the «Borrow / Multiply» pairs. A loop on
 *   a pair is built from this borrow side like any other lender's.
 * - /v3/labels/vaults: the market (product) and curator names.
 * - /v3/apys/intrinsic: the collateral asset's own yield (wstETH staking, sUSDe…). A
 *   collateral held in an EVK vault also earns that vault's supply APY.
 *
 * PT collaterals are left out: PendleLoop's list already brings Euler's PT markets
 * (lending/pendle-loop.ts), and the same market twice would be two loop rows.
 */

const CFG = lending.euler;

interface Vault {
  chainId: number;
  address: string;
  isEscrow?: boolean;
  symbol?: string;
  asset?: { address: string; symbol: string; decimals: number };
  totalSupplyUsd?: number;
  totalBorrowsUsd?: number;
  utilization?: number;
  supplyApy?: number;
  borrowApy?: number;
  snapshotTimestamp?: string;
  visibility?: { status?: string; explorableLend?: boolean; explorableBorrow?: boolean; reason?: string | null };
}
interface Collateral {
  collateral: string;
  vaultType?: string;
  asset: string;
  assetSymbol: string;
  borrowLTV: string;
  liquidationLTV: string;
  initialLiquidationLTV?: string;
  targetTimestamp?: string;
  rampDuration?: number;
}
interface Label {
  address: string;
  isDeprecated?: boolean;
  resolved?: { name?: string | null; entityId?: string | null; deprecated?: boolean } | null;
}
interface Intrinsic {
  address: string;
  apy: number;
  provider?: string;
  description?: string;
}
interface Page<T> {
  data: T[];
  meta?: { total?: number };
}

const isPage = <T>(b: unknown): b is Page<T> => isObject(b) && Array.isArray((b as { data?: unknown }).data);
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const lc = (a: string) => a.toLowerCase();
const PAGE = 100;

/** Every page of a list route (the API caps one page at 100 rows). */
async function all<T>(path: string): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; offset < 5000; offset += PAGE) {
    const sep = path.includes('?') ? '&' : '?';
    const page = await fetchJson<Page<T>>(CFG.name, `${CFG.api}${path}${sep}limit=${PAGE}&offset=${offset}`, isPage<T>);
    out.push(...page.data);
    if (page.data.length < PAGE || (page.meta?.total !== undefined && out.length >= page.meta.total)) break;
  }
  return out;
}

export const eulerTokenLogo = (chainId: number, address: string) => `${CFG.api}/images/tokens/${chainId}/${address}`;
export const eulerLendUrl = (chainId: number, vault: string) => `${CFG.app}/lend/${vault}?network=${chainId}`;
export const eulerBorrowUrl = (chainId: number, collateralVault: string, borrowVault: string) => `${CFG.app}/borrow/${collateralVault}/${borrowVault}?network=${chainId}`;

/** A liquidation LTV that is ramping down applies the lower of where it starts and where it lands. */
export function liquidationLtvOf(c: Pick<Collateral, 'liquidationLTV' | 'initialLiquidationLTV' | 'targetTimestamp' | 'rampDuration'>, now: number): number {
  const target = Number(c.liquidationLTV) / 10_000;
  const initial = c.initialLiquidationLTV !== undefined ? Number(c.initialLiquidationLTV) / 10_000 : target;
  const ramping = (c.rampDuration ?? 0) > 0 && c.targetTimestamp !== undefined && Date.parse(c.targetTimestamp) > now;
  return ramping ? Math.min(target, initial) : target;
}

export function eulerBorrowSide(v: Vault, collaterals: Collateral[], byVault: Map<string, Vault>, intrinsic: Map<string, number>, now: number): BorrowSide | null {
  if (!fin(v.borrowApy)) return null;
  const list = collaterals.flatMap((c) => {
    const maxLtv = liquidationLtvOf(c, now);
    const borrowLtv = Number(c.borrowLTV) / 10_000;
    if (!(maxLtv > 0 && maxLtv < 1) || !(borrowLtv > 0) || /^PT-/i.test(c.assetSymbol)) return [];
    const own = intrinsic.get(lc(c.asset));
    const held = byVault.get(lc(c.collateral));
    const supply = held && !held.isEscrow && fin(held.supplyApy) && held.supplyApy > 0 ? held.supplyApy : null;
    return [
      {
        token: { symbol: c.assetSymbol, address: c.asset },
        maxLtv,
        ...(borrowLtv < maxLtv ? { borrowLtv } : {}),
        yield: own !== undefined && own > 0 && own < 100 ? { pct: own, kind: 'apy' as const, source: 'بازده خود دارایی (Euler API)' } : null,
        supplyPct: supply,
        logo: eulerTokenLogo(v.chainId, c.asset),
      },
    ];
  });
  if (!list.length) return null;
  const supplied = fin(v.totalSupplyUsd) ? v.totalSupplyUsd : null;
  const borrowed = fin(v.totalBorrowsUsd) ? v.totalBorrowsUsd : null;
  return {
    ratePct: v.borrowApy,
    curve: null,
    availableUsd: supplied !== null && borrowed !== null ? Math.max(0, supplied - borrowed) : null,
    collateral: list,
    metric: 'ltv',
  };
}

export function eulerOpportunity(v: Vault, borrow: BorrowSide | null, label: Label | undefined, fetchedAt: string): Opportunity | null {
  if (!v.asset || !fin(v.supplyApy) || v.isEscrow) return null;
  const network = networkByChainId(v.chainId);
  const market = label?.resolved?.name ?? v.symbol ?? v.asset.symbol;
  const cash = fin(v.totalSupplyUsd) && fin(v.totalBorrowsUsd) ? Math.max(0, v.totalSupplyUsd - v.totalBorrowsUsd) : null;
  return {
    key: `euler:${network.key}:${lc(v.address)}:supply`,
    family: 'lend',
    protocol: { id: 'euler', version: 'evk', name: 'Euler' },
    chain: network.key,
    market: { id: v.address, address: v.address, name: `${v.asset.symbol} · ${market}` },
    assets: { deposit: [{ symbol: v.asset.symbol, address: v.asset.address }], ...(borrow ? { collateral: borrow.collateral.map((c) => c.token) } : {}) },
    rate: { value: v.supplyApy, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: fetchedAt },
    maturity: null,
    capacity: { depositRemainingUsd: null, withdrawableNowUsd: cash },
    exit: { type: 'instant', note: 'برداشت فقط تا نقدینگی آزاد خزانه؛ در استفاده‌ی نزدیک ۱۰۰٪ ممکن است موقتاً ممکن نباشد.' },
    rewards: [],
    supplyCurve: null,
    borrow,
    risk: { oracle: null, curator: label?.resolved?.entityId ?? null, paused: false, incidents: [] },
    quality: 'current',
    sources: [{ name: 'Euler API', url: `${CFG.api}/evk/vaults?chainId=${v.chainId}`, fetchedAt, sourceUpdatedAt: v.snapshotTimestamp ?? null }],
    notes: ['خزانه‌ی EVK اویلر؛ نرخ‌ها از API عمومی Euler (v3). پاداش‌ها جدا (Merkl) حساب می‌شوند.'],
    url: eulerLendUrl(v.chainId, v.address),
    icon: eulerTokenLogo(v.chainId, v.asset.address),
  };
}

async function fetchChain(chainId: number, fetchedAt: string, now: number): Promise<Opportunity[]> {
  const [vaults, labels, intrinsic] = await Promise.all([
    all<Vault>(`/evk/vaults?chainId=${chainId}`),
    all<Label>(`/labels/vaults?chainId=${chainId}`).catch(() => [] as Label[]),
    all<Intrinsic>(`/apys/intrinsic?chainId=${chainId}`).catch(() => [] as Intrinsic[]),
  ]);
  const byVault = new Map(vaults.map((v) => [lc(v.address), v]));
  const labelOf = new Map(labels.map((l) => [lc(l.address), l]));
  const own = new Map(intrinsic.filter((x) => fin(x.apy)).map((x) => [lc(x.address), x.apy]));
  const listed = vaults.filter((v) => !v.isEscrow && v.asset && (v.visibility?.explorableLend || v.visibility?.explorableBorrow) && fin(v.totalSupplyUsd) && v.totalSupplyUsd >= CFG.minSupplyUsd && !labelOf.get(lc(v.address))?.isDeprecated);
  const reads = await mapLimit(listed, CFG.concurrency, async (v) => {
    const collaterals = v.visibility?.explorableBorrow ? (await fetchJson<Page<Collateral>>(CFG.name, `${CFG.api}/evk/vaults/${chainId}/${v.address}/collaterals`, isPage<Collateral>)).data : [];
    const borrow = collaterals.length ? eulerBorrowSide(v, collaterals, byVault, own, now) : null;
    // A vault only Euler's app hides on the lend side still lends to loops (its borrow side).
    const o = eulerOpportunity(v, borrow, labelOf.get(lc(v.address)), fetchedAt);
    return o && !v.visibility?.explorableLend ? { ...o, family: 'borrow' as const } : o;
  });
  return reads.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []));
}

export async function fetchEuler(fetchedAt: string, now = Date.parse(fetchedAt)): Promise<Opportunity[]> {
  const chains = await Promise.allSettled(CFG.chains.map((id) => fetchChain(id, fetchedAt, now)));
  const ok = chains.filter((c): c is PromiseFulfilledResult<Opportunity[]> => c.status === 'fulfilled');
  if (!ok.length) throw (chains[0] as PromiseRejectedResult).reason;
  return ok.flatMap((c) => c.value);
}
