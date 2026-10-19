import { pathSlug } from '../market/links';
import lending from '../../config/lending.json';
import type { AssetYield, Opportunity } from '../../types/opportunity';
import { fetchJson, isArrayOf, isObject, mapLimit, withRetry } from '../protocols/base';
import { tokenClass } from '../merkl/vetting';
import { formatPercent } from '../utils/formatting';

const ZERO = '0x0000000000000000000000000000000000000000';

/**
 * Fluid (Instadapp) — lending (fTokens) and borrowing vaults, from Fluid's public API
 * `api.fluid.instadapp.io/v2` (the one fluid.io reads):
 *
 * - GET /v2/lending/{chainId}/tokens → fTokens: `supplyRate`, `rewardsRate` (bps),
 *   `totalAssets` and `liquiditySupplyData.withdrawable` (raw asset units), the asset's USD price.
 * - GET /v2/{chainId}/vaults        → vaults: `collateralFactor` (max LTV) and
 *   `liquidationThreshold` (bps of 10 000), `supplyRate.vault.rate` (what collateral
 *   earns) and `borrowRate.vault.rate` (bps), `borrowable` (raw debt units), each
 *   token's `price` and `stakingApr` (the token's own yield, bps).
 *
 * No published schema: units were checked against the live response on 2026-10-15
 * (USDC borrow 785 = 7.85 %, ETH vault collateral factor 8 500 = 85 %), so every row
 * is at most «partial».
 *
 * Every vault type is read (see `fluidVault`): plain (T1), smart collateral (T2), smart
 * debt (T3) and both (T4). A vault becomes a borrow-only opportunity: it feeds loops and
 * the cost of a loan, never the earn list.
 */

const CFG = lending.fluid;

interface FluidToken {
  address: string;
  symbol: string;
  decimals: number | string;
  price?: string;
  logoUrl?: string;
  /** The token's own yield (staking, savings), bps. */
  stakingApr?: string | number;
}
export interface FluidVault {
  id: string;
  type: string;
  address: string;
  supplyToken: { token0: FluidToken; token1?: Partial<FluidToken> };
  borrowToken: { token0: FluidToken; token1?: Partial<FluidToken> };
  collateralFactor: number | string;
  liquidationThreshold: number | string;
  supplyRate: { vault?: { rate?: number | string } };
  borrowRate: { vault?: { rate?: number | string } };
  borrowable?: string;
  totalBorrow?: string;
  supplyDexData?: Dex;
  borrowDexData?: Dex;
}
export interface FluidFToken {
  address: string;
  symbol: string;
  decimals: number | string;
  asset: FluidToken;
  supplyRate: string | number;
  rewardsRate?: string | number;
  totalAssets: string;
  liquiditySupplyData?: { withdrawable?: string };
}

const num = (x: unknown): number | null => {
  const n = typeof x === 'string' ? Number(x) : typeof x === 'number' ? x : NaN;
  return Number.isFinite(n) ? n : null;
};
const bps = (x: unknown) => {
  const n = num(x);
  return n === null ? null : n / 100;
};
const units = (raw: unknown, decimals: unknown) => {
  const n = num(raw);
  const d = num(decimals);
  return n === null || d === null ? null : n / 10 ** d;
};
const chainKey = (id: number) => `eip155:${id}`;
const app = (id: number) => `${CFG.app}/${id}`;
/** fluid.io's own token slug in /{chain}/lending/{slug}. */
const slug = pathSlug;

/** One fToken as a lending opportunity; null when unreadable or below the size floor. */
export function fluidLending(t: FluidFToken, chainId: number, fetchedAt: string): Opportunity | null {
  const rate = bps(t.supplyRate);
  const price = num(t.asset?.price);
  const total = units(t.totalAssets, t.asset?.decimals ?? t.decimals);
  if (rate === null || rate < 0 || rate > 1000 || price === null || !(price > 0) || total === null) return null;
  const supplyUsd = total * price;
  if (supplyUsd < CFG.minSupplyUsd) return null;
  const withdrawable = units(t.liquiditySupplyData?.withdrawable, t.asset.decimals);
  const reward = bps(t.rewardsRate) ?? 0;
  return {
    key: `fluid:${chainKey(chainId)}:${t.address.toLowerCase()}:supply`,
    family: 'lend',
    protocol: { id: 'fluid', version: null, name: 'Fluid' },
    chain: chainKey(chainId),
    market: { id: t.address, address: t.address, name: `${t.asset.symbol} · Fluid Lending` },
    assets: { deposit: [{ symbol: t.asset.symbol, address: t.asset.address.toLowerCase() }] },
    rate: { value: rate, kind: 'apr', feesIncluded: true, rewardsIncluded: false, at: fetchedAt },
    maturity: null,
    capacity: { depositRemainingUsd: null, uncapped: true, withdrawableNowUsd: withdrawable === null ? null : withdrawable * price },
    exit: { type: 'instant', note: 'برداشت تا سقف برداشت لایه‌ی نقدینگی فلوئید.' },
    rewards: [],
    quality: 'partial',
    sources: [{ name: 'Fluid API', url: CFG.api, fetchedAt, sourceUpdatedAt: null }],
    notes: ['منبع Fluid: API عمومی fluid.io؛ واحدها (bps) با پاسخ زنده بررسی شد، طرح رسمی منتشر نشده.', ...(reward > 0 ? [`پاداش fToken (${formatPercent(reward, 2)}) در نرخ حساب نشده است.`] : [])],
    url: `${app(chainId)}/lending/${slug(t.asset.symbol)}`,
    icon: t.asset.logoUrl ?? null,
  };
}

interface Dex {
  address?: string;
  token0RealReserves?: string | number;
  token1RealReserves?: string | number;
}
interface SideRates {
  liquidity?: { token0?: string | number; token1?: string | number };
  dex?: { trading?: string | number };
  vault?: { rate?: string | number };
}

export type FluidVaultType = 'T1' | 'T2' | 'T3' | 'T4';
export const FLUID_TYPE_LABEL: Record<FluidVaultType, string> = {
  T1: 'ساده',
  T2: 'وثیقه‌ی هوشمند',
  T3: 'بدهی هوشمند',
  T4: 'وثیقه و بدهی هوشمند',
};

const CLASSES = new Set(['usd', 'eth', 'btc']);

/**
 * Each token's share of a DEX position by USD value. Fluid DEX keeps reserves in a
 * 12-decimal precision whatever the token's decimals (checked on live pools: the two
 * reserves of sUSDe+USDT are of the same order), so raw ÷ 1e12 is token units.
 */
function weights(dex: Dex | undefined, p0: number, p1: number): [number, number] | null {
  const r0 = (num(dex?.token0RealReserves) ?? 0) / 1e12;
  const r1 = (num(dex?.token1RealReserves) ?? 0) / 1e12;
  const v0 = r0 * p0;
  const v1 = r1 * p1;
  return v0 + v1 > 0 ? [v0 / (v0 + v1), v1 / (v0 + v1)] : null;
}

/**
 * One vault as a borrow-only opportunity: borrow its debt against its collateral.
 * LTV: collateral factor (borrowing stops) under the liquidation threshold.
 *
 *   T1  collateral earns its own yield + the vault's supply rate; debt costs the vault's borrow rate.
 *   T2  smart collateral — a DEX position of two tokens: Σ share × (Liquidity supply rate +
 *       own yield) + the DEX trading APR.
 *   T3  smart debt — owed as a DEX position: Σ share × Liquidity borrow rate − trading APR
 *       (the fees the debt position earns lower its cost; it can go below zero).
 *   T4  both.
 * Fluid reports smart vaults' own `vault.rate` as 0; the parts above are what it is made of.
 * Two-token sides get a class only when both tokens share it (USD+USD, ETH+ETH, BTC+BTC).
 */
export function fluidVault(v: FluidVault, chainId: number, fetchedAt: string): Opportunity | null {
  const type = `T${v.type}` as FluidVaultType;
  if (!(type in FLUID_TYPE_LABEL)) return null;
  const c0 = v.supplyToken?.token0;
  const c1 = v.supplyToken?.token1;
  const d0 = v.borrowToken?.token0;
  const d1 = v.borrowToken?.token1;
  const smartC = !!c1?.symbol && !!c1.address && c1.address !== ZERO;
  const smartD = !!d1?.symbol && !!d1.address && d1.address !== ZERO;
  if (!c0?.address || !d0?.address || !c0.symbol || !d0.symbol) return null;
  const cf = (num(v.collateralFactor) ?? NaN) / 10_000;
  const lt = (num(v.liquidationThreshold) ?? NaN) / 10_000;
  if (!(lt > 0 && lt < 1) || !(cf > 0)) return null;
  const pc0 = num(c0.price);
  const pd0 = num(d0.price);
  const pc1 = smartC ? num(c1!.price) : null;
  const pd1 = smartD ? num(d1!.price) : null;
  if (pc0 === null || pd0 === null || (smartC && pc1 === null) || (smartD && pd1 === null)) return null;
  const sr = v.supplyRate as SideRates;
  const br = v.borrowRate as SideRates;

  // Collateral side.
  let yieldPct: number;
  let supplyPct: number | null = null;
  let parts: string;
  let cClass: 'usd' | 'eth' | 'btc' | undefined;
  const c0Class = tokenClass({ symbol: c0.symbol });
  if (smartC) {
    const w = weights(v.supplyDexData, pc0, pc1 as number);
    if (!w) return null;
    const own = w[0] * ((bps(sr.liquidity?.token0) ?? 0) + (bps(c0.stakingApr) ?? 0)) + w[1] * ((bps(sr.liquidity?.token1) ?? 0) + (bps(c1!.stakingApr) ?? 0));
    yieldPct = own + (bps(sr.dex?.trading) ?? 0);
    parts = 'سود سپرده و بازده هر توکن به نسبت سهمش + کارمزد معامله‌ی DEX';
    const k = tokenClass({ symbol: c1!.symbol as string });
    cClass = c0Class === k && CLASSES.has(k) ? (k as 'usd' | 'eth' | 'btc') : undefined;
  } else {
    yieldPct = bps(c0.stakingApr) ?? 0;
    const s = bps(sr.vault?.rate) ?? bps(sr.liquidity?.token0);
    supplyPct = s !== null && s > 0 && s < 100 ? s : null;
    parts = 'stakingApr';
  }

  // Debt side.
  let ratePct: number | null;
  let debtClass: 'usd' | 'eth' | 'btc' | undefined;
  if (smartD) {
    const w = weights(v.borrowDexData, pd0, pd1 as number) ?? [0.5, 0.5];
    ratePct = w[0] * (bps(br.liquidity?.token0) ?? 0) + w[1] * (bps(br.liquidity?.token1) ?? 0) - (bps(br.dex?.trading) ?? 0);
    const k0 = tokenClass({ symbol: d0.symbol });
    const k1 = tokenClass({ symbol: d1!.symbol as string });
    debtClass = k0 === k1 && CLASSES.has(k0) ? (k0 as 'usd' | 'eth' | 'btc') : undefined;
    // Without one class the debt is not a single asset: no loop is built on it.
    if (!debtClass) return null;
  } else ratePct = bps(br.vault?.rate) ?? bps(br.liquidity?.token0);
  if (ratePct === null || ratePct > 1000) return null;

  // Borrowable is in debt-token units on plain debt; on smart debt its unit is not established.
  const borrowable = smartD ? null : units(v.borrowable, d0.decimals);
  const cSym = smartC ? `${c0.symbol}+${c1!.symbol}` : c0.symbol;
  const dSym = smartD ? `${d0.symbol}+${d1!.symbol}` : d0.symbol;
  const cAddr = (smartC ? (v.supplyDexData?.address ?? v.address) : c0.address).toLowerCase();
  const dAddr = (smartD ? (v.borrowDexData?.address ?? v.address) : d0.address).toLowerCase();
  const name = `${cSym}/${dSym} · Fluid ${type} #${v.id}`;
  return {
    key: `fluid:${chainKey(chainId)}:${v.address.toLowerCase()}:borrow`,
    family: 'borrow',
    protocol: { id: 'fluid', version: `vault-${type.toLowerCase()}`, name: 'Fluid' },
    chain: chainKey(chainId),
    market: { id: v.id, address: v.address, name },
    assets: { deposit: [{ symbol: dSym, address: dAddr }], collateral: [{ symbol: cSym, address: cAddr }] },
    rate: { value: null, kind: 'apr', feesIncluded: true, rewardsIncluded: false, at: fetchedAt },
    maturity: null,
    capacity: { depositRemainingUsd: null, withdrawableNowUsd: null },
    exit: { type: 'instant' },
    rewards: [],
    borrow: {
      ratePct,
      curve: null,
      availableUsd: borrowable === null ? null : borrowable * pd0,
      collateral: [
        {
          token: { symbol: cSym, address: cAddr },
          maxLtv: lt,
          ...(cf < lt ? { borrowLtv: cf } : {}),
          yield: yieldPct > 0 && yieldPct < 100 ? { pct: yieldPct, kind: 'apr', source: `Fluid (${parts})` } : null,
          supplyPct,
          ...(cClass ? { class: cClass } : {}),
        },
      ],
      metric: 'ltv',
      ...(debtClass ? { debtClass } : {}),
    },
    quality: 'partial',
    sources: [{ name: 'Fluid API', url: CFG.api, fetchedAt, sourceUpdatedAt: null }],
    notes: [
      'منبع Fluid: API عمومی fluid.io؛ واحدها (bps) با پاسخ زنده بررسی شد، طرح رسمی منتشر نشده.',
      `خزانه‌ی ${FLUID_TYPE_LABEL[type]} فلوئید؛ نرخ‌ها APR گزارش می‌شوند.`,
      ...(smartC ? ['وثیقه موقعیت DEX دوتوکنی است: کارمزد معامله متغیر است و سهم هر توکن با معامله‌ها عوض می‌شود.'] : []),
      ...(smartD ? ['بدهی موقعیت DEX دوتوکنی است: کارمزد معامله هزینه‌ی وام را کم می‌کند و متغیر است؛ مقدار قابل وام گزارش نشده.'] : []),
    ],
    // The vault's own page (route in fluid.io's app: /{chain}/borrowing/vaults/{id}).
    url: `${app(chainId)}/borrowing/vaults/${v.id}`,
    icon: d0.logoUrl ?? null,
  };
}

export async function fetchFluid(fetchedAt: string): Promise<Opportunity[]> {
  const reads = await mapLimit(CFG.chains as number[], 2, async (id) => {
    const [tokens, vaults] = await Promise.all([
      withRetry(() => fetchJson<{ data?: FluidFToken[] }>(CFG.name, `${CFG.api}/lending/${id}/tokens`, isObject)),
      withRetry(() => fetchJson<FluidVault[]>(CFG.name, `${CFG.api}/${id}/vaults`, isArrayOf<FluidVault>)),
    ]);
    return [...(tokens.data ?? []).map((t) => fluidLending(t, id, fetchedAt)), ...vaults.map((v) => fluidVault(v, id, fetchedAt))].filter((o): o is Opportunity => o !== null);
  });
  const ok = reads.filter((r): r is PromiseFulfilledResult<Opportunity[]> => r.status === 'fulfilled');
  if (CFG.chains.length && !ok.length) throw (reads[0] as PromiseRejectedResult).reason;
  return ok.flatMap((r) => r.value);
}
