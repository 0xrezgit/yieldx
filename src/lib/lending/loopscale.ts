import lending from '../../config/lending.json';
import type { Opportunity, RewardStream } from '../../types/opportunity';
import { isObject, postJson, withRetry } from '../protocols/base';
import { fetchSolanaTokens } from '../protocols/jupiter';
import { isDollarDebt, rwaLogo } from '../opportunity/rwa';

/**
 * Loopscale lending vaults («Lend / Earn») on Solana.
 *
 * Source: POST https://tars.loopscale.com/v1/markets/lending_vaults/info — keyless,
 * described by Loopscale as a partner API. Field meanings come from third-party
 * clients (@1delta/margin-fetcher-sol 0.0.1, @solana-compass/sdk 0.3.5), not from
 * Loopscale's own documentation: every vault is marked unofficial and at most
 * «partial» quality. Checked against the live response on 2026-10-01: the gross rate
 * below matches the API's own `strategySummary.wAvgApy` for every vault.
 *
 * Meanings used:
 * - Amounts (`tokenBalance`, `currentDeployedAmount`, `externalYieldAmount`) are in
 *   the principal mint's native units, sent as numbers or decimal strings.
 * - `interestPerSecond`: native units per second across the strategy's loans.
 * - `interestFee`, `externalYieldInfo.apy`: CBPS — 1 000 000 = 100%.
 * - `strategySummary.totalSupplyUsd`: the vault's assets in USD (with
 *   `includeStrategySummaries`), used only to price one native unit.
 * - `vaultMetadata.depositCap`: the vault's deposit cap in native units (null = none
 *   published). It is set by the manager, not on-chain (`supplyCaps` there is u64 max).
 * - `vaultRewardsSchedules[].rewardEndTime`: Unix seconds, sent as a string.
 *
 * Rate: lending APR = interestPerSecond × year ÷ total assets × (1 − interestFee),
 * plus the idle part's external yield. Simple APR: loans pay interest, not compounding.
 */

const CFG = lending.loopscale;
const YEAR_S = 365 * 86_400;
const CBPS = 1_000_000;

type Wire = number | string | null | undefined;
export interface LoopscaleVaultInfo {
  vault: { address: string; principalMint: string; depositsEnabled?: boolean };
  vaultMetadata?: { name?: string | null; depositCap?: Wire } | null;
  vaultStrategy?: {
    strategy?: { tokenBalance?: Wire; currentDeployedAmount?: Wire; externalYieldAmount?: Wire; interestPerSecond?: Wire; interestFee?: Wire };
    externalYieldInfo?: { apy?: Wire } | null;
  } | null;
  vaultRewardsSchedules?: { rewardMint?: string; rewardEndTime?: Wire }[] | null;
  strategySummary?: { totalSupplyUsd?: number } | null;
  pause?: { depositsPaused?: boolean; withdrawalsPaused?: boolean } | null;
}
interface VaultsPage {
  lendVaults: LoopscaleVaultInfo[];
  total?: number;
  hasMore?: boolean;
}

const n = (x: Wire): number | null => {
  const v = typeof x === 'string' ? Number(x) : typeof x === 'number' ? x : NaN;
  return Number.isFinite(v) ? v : null;
};

export function loopscaleVault(v: LoopscaleVaultInfo, fetchedAt: string, symbol: string | null): Opportunity | null {
  const s = v.vaultStrategy?.strategy;
  if (!v.vault?.address || !v.vault.principalMint || !s) return null;
  const idle = n(s.tokenBalance) ?? 0;
  const deployed = n(s.currentDeployedAmount) ?? 0;
  const external = n(s.externalYieldAmount) ?? 0;
  const total = idle + deployed + external;
  const ips = n(s.interestPerSecond);
  const fee = n(s.interestFee) ?? 0;
  const totalUsd = n(v.strategySummary?.totalSupplyUsd ?? null);
  if (!(total > 0) || ips === null || ips < 0 || fee < 0 || fee > CBPS || totalUsd === null || totalUsd < CFG.minSupplyUsd) return null;
  const unitUsd = totalUsd / total;
  const lendingApr = ((ips * YEAR_S) / total) * (1 - fee / CBPS);
  const extApy = (n(v.vaultStrategy?.externalYieldInfo?.apy ?? null) ?? 0) / CBPS;
  const apr = (lendingApr + (external / total) * extApy) * 100;
  if (!(apr >= 0 && apr < 200)) return null;
  const now = new Date(fetchedAt).getTime();
  const rewards: RewardStream[] = (v.vaultRewardsSchedules ?? [])
    .map((r) => ({ mint: r.rewardMint, end: n(r.rewardEndTime ?? null) }))
    // Most schedules in the live list have already ended; only running ones are listed.
    .filter((r) => r.mint && (r.end === null || r.end * 1000 > now))
    .map((r) => ({
      key: `loopscale:${v.vault.address}:${r.mint}`,
      source: 'protocol' as const,
      kind: 'token' as const,
      token: { symbol: null, address: r.mint as string, chain: 'solana:mainnet' },
      // Emissions without a validated price: listed, never counted in dollars.
      aprUsd: null,
      endsAt: r.end ? new Date(r.end * 1000).toISOString() : null,
      conditional: false,
      vesting: false,
    }));
  const paused = !!v.pause?.depositsPaused || v.vault.depositsEnabled === false;
  const cap = n(v.vaultMetadata?.depositCap ?? null);
  return {
    key: `loopscale:solana:mainnet:${v.vault.address}:vault`,
    family: 'vault',
    protocol: { id: 'loopscale', version: 'vault', name: 'Loopscale' },
    chain: 'solana:mainnet',
    market: { id: v.vault.address, address: v.vault.address, name: v.vaultMetadata?.name ?? `${symbol ?? '—'} Vault` },
    assets: { deposit: [{ symbol, address: v.vault.principalMint }] },
    rate: { value: apr, kind: 'apr', feesIncluded: true, rewardsIncluded: false, at: fetchedAt },
    maturity: null,
    capacity: { depositRemainingUsd: cap === null || cap <= 0 ? null : Math.max(0, cap - total) * unitUsd, withdrawableNowUsd: v.pause?.withdrawalsPaused ? 0 : (idle + external) * unitUsd },
    exit: { type: 'instant', note: 'برداشت فوری تا موجودی آزاد خزانه؛ بقیه در وام‌های مدت‌دار است.' },
    rewards,
    risk: { paused },
    quality: 'partial',
    sources: [{ name: 'Loopscale API', url: CFG.api, fetchedAt, sourceUpdatedAt: null }],
    notes: ['منبع Loopscale: API شرکا بدون مستندات عمومی؛ معنای فیلدها از کلاینت شخص ثالث.', 'نرخ از سود لحظه‌ای وام‌های فعال خزانه (پس از کارمزد) و بازده بخش بیکار حساب شد.'],
    url: CFG.app,
    unofficialSource: true,
  };
}

const isPage = (b: unknown): b is VaultsPage => isObject<VaultsPage>(b) && Array.isArray((b as VaultsPage).lendVaults);

/** One Loopscale loop market (POST /v1/markets/loop/info, keyed by its slug); fields as the live answer sends them. */
export interface LoopscaleLoopInfo {
  collateralMint: string;
  principalMint: string;
  name?: string | null;
  /** The collateral's own yield, %. */
  collateralApyPct?: number | null;
  maxLeverage?: number | null;
  /** Net APY at `maxLeverage` with today's best borrow, %; 0 when nothing can be borrowed. */
  maxLeveragedApyPct?: number | null;
  /** What lenders offer now, principal native units. */
  principalAmountAvailable?: number | null;
  /** Borrowers' leverage and net APY, weighted by size. */
  wAvgLeverage?: number | null;
  wAvgApy?: number | null;
  totalPrincipalDeployed?: number | null;
  totalPrincipalDeployedUsd?: number | null;
  feVisible?: boolean | null;
}

/**
 * A Loopscale loop as a borrow side (like a Kamino reserve's): its principal is the debt,
 * its collateral the one token it takes. The loop builder pairs them, so a Loopscale loop
 * gets the same leverage policy, RWA label and «no capacity» handling as any other.
 *
 * Loopscale lends through an order book: there is no one borrow rate. It is read back from
 * what the API gives — the net APY at the highest leverage with today's best offers
 * (L·y − (L−1)·b), else the borrowers' size-weighted average (their own leverage and APY).
 * The liquidation LTV is not sent: the borrow limit (1 − 1/max leverage) stands in, which
 * puts liquidation no further than it really is. A PT collateral carries no yield here; the
 * PT loop builder prices it from its own market.
 */
export function loopscaleLoop(slug: string, l: LoopscaleLoopInfo, fetchedAt: string): Opportunity | null {
  if (l.feVisible === false || !l.collateralMint || !l.principalMint) return null;
  const [cSym, dSym] = (l.name ?? '').split('/').map((x) => x.trim());
  const L = n(l.maxLeverage ?? null);
  const y = n(l.collateralApyPct ?? null);
  if (!cSym || !dSym || L === null || !(L > 1) || y === null || !(y > 0) || y > 100) return null;
  const top = n(l.maxLeveragedApyPct ?? null);
  const wL = n(l.wAvgLeverage ?? null);
  const wApy = n(l.wAvgApy ?? null);
  const fromTop = top !== null && top !== 0 ? (L * y - top) / (L - 1) : null;
  const fromAvg = wL !== null && wL > 1 && wApy !== null ? (wL * y - wApy) / (wL - 1) : null;
  const ratePct = fromTop !== null && fromTop >= 0 && fromTop < 100 ? fromTop : fromAvg !== null && fromAvg >= 0 && fromAvg < 100 ? fromAvg : null;
  if (ratePct === null) return null;
  const deployed = n(l.totalPrincipalDeployed ?? null);
  const deployedUsd = n(l.totalPrincipalDeployedUsd ?? null);
  const unitUsd = deployed && deployed > 0 && deployedUsd !== null ? deployedUsd / deployed : null;
  const free = n(l.principalAmountAvailable ?? null) ?? 0;
  const availableUsd = free <= 0 ? 0 : unitUsd !== null ? free * unitUsd : null;
  const isPt = /^PT-/i.test(cSym);
  const borrowLtv = 1 - 1 / L;
  return {
    key: `loopscale:solana:mainnet:${slug}:loop`,
    family: 'borrow',
    protocol: { id: 'loopscale', version: 'loop', name: 'Loopscale' },
    chain: 'solana:mainnet',
    market: { id: slug, address: null, name: `${cSym}/${dSym} · Loopscale` },
    assets: { deposit: [{ symbol: dSym, address: l.principalMint }], collateral: [{ symbol: cSym, address: l.collateralMint }] },
    rate: { value: null, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: fetchedAt },
    maturity: null,
    capacity: { depositRemainingUsd: null, withdrawableNowUsd: null },
    exit: { type: 'instant' },
    rewards: [],
    borrow: {
      ratePct,
      ratePct7d: null,
      curve: null,
      availableUsd,
      collateral: [
        {
          token: { symbol: cSym, address: l.collateralMint },
          maxLtv: borrowLtv,
          yield: isPt ? null : { pct: y, kind: 'apy', source: 'Loopscale (بازده خود وثیقه)' },
          ...(rwaLogo('solana:mainnet', l.collateralMint) ? { logo: rwaLogo('solana:mainnet', l.collateralMint) as string } : {}),
        },
      ],
      metric: 'ltv',
      ...(isDollarDebt('solana:mainnet', l.principalMint) ? { debtClass: 'usd' as const } : {}),
    },
    quality: 'partial',
    sources: [{ name: 'Loopscale API', url: CFG.api, fetchedAt, sourceUpdatedAt: null }],
    notes: [
      'منبع Loopscale: API شرکا (/markets/loop/info) بدون مستندات عمومی.',
      fromTop !== null && ratePct === fromTop
        ? `Loopscale وام را از دفتر سفارش می‌دهد و نرخ واحد ندارد: نرخ ${ratePct.toFixed(2)}٪ از APY در سقف اهرم با بهترین پیشنهادهای امروز برگردانده شد.`
        : `Loopscale الان پیشنهاد وامی ندارد؛ نرخ ${ratePct.toFixed(2)}٪ میانگین وام‌گیرندگان فعلی است.`,
      'حد لیکوییدشدن منتشر نمی‌شود: سقف وام (۱ − ۱/اهرم بیشینه) به جای آن گذاشته شد، یعنی فاصله تا لیکوییدشدن کمتر از واقع نشان داده نمی‌شود.',
    ],
    url: CFG.home,
    unofficialSource: true,
  };
}

const isLoops = (b: unknown): b is Record<string, LoopscaleLoopInfo> => isObject(b) && !Array.isArray(b);

export async function fetchLoopscale(fetchedAt: string): Promise<Opportunity[]> {
  const vaults: LoopscaleVaultInfo[] = [];
  for (let page = 0; page < CFG.maxPages; page++) {
    const d = await withRetry(() => postJson<VaultsPage>(CFG.name, `${CFG.api}/markets/lending_vaults/info`, { page, pageSize: CFG.pageSize, includeStrategySummaries: true, depositsEnabled: true }, isPage));
    vaults.push(...d.lendVaults);
    if (d.hasMore === false || d.lendVaults.length < CFG.pageSize) break;
  }
  // Loops are best-effort beside the vaults: a failed read leaves the vaults in place.
  const loops = await withRetry(() => postJson<Record<string, LoopscaleLoopInfo>>(CFG.name, `${CFG.api}/markets/loop/info`, {}, isLoops)).catch(() => ({}) as Record<string, LoopscaleLoopInfo>);
  const loopRows = Object.entries(loops)
    .map(([slug, l]) => loopscaleLoop(slug, l, fetchedAt))
    .filter((o): o is Opportunity => o !== null);
  const tokens = await fetchSolanaTokens([...vaults.map((v) => v.vault?.principalMint), ...loopRows.flatMap((o) => [o.assets.deposit[0]?.address, o.assets.collateral?.[0]?.address])].filter((x): x is string => !!x));
  const withLogos = loopRows.map((o) => {
    const c = o.borrow!.collateral[0];
    const logo = c.logo ?? tokens.get(c.token.address ?? '')?.icon ?? undefined;
    const icon = tokens.get(o.assets.deposit[0]?.address ?? '')?.icon ?? null;
    return { ...o, icon, borrow: { ...o.borrow!, collateral: [logo ? { ...c, logo } : c] } };
  });
  return [
    ...vaults
      .map((v) => {
        const t = tokens.get(v.vault?.principalMint);
        const o = loopscaleVault(v, fetchedAt, t?.symbol ?? null);
        return o && t?.icon ? { ...o, icon: t.icon } : o;
      })
      .filter((o): o is Opportunity => o !== null),
    ...withLogos,
  ];
}
