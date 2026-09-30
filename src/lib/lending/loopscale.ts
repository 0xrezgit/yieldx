import lending from '../../config/lending.json';
import type { Opportunity, RewardStream } from '../../types/opportunity';
import { isObject, postJson, withRetry } from '../protocols/base';
import { fetchSolanaTokens } from '../protocols/jupiter';

/**
 * Loopscale lending vaults («Lend / Earn») on Solana.
 *
 * Source: POST https://tars.loopscale.com/v1/markets/lending_vaults/info — keyless,
 * described by Loopscale as a partner API. Field meanings come from third-party
 * clients (@1delta/margin-fetcher-sol 0.0.1, @solana-compass/sdk 0.3.5), not from
 * Loopscale's own documentation, and could not be called from the build
 * environment: every vault is marked unofficial and at most «partial» quality.
 *
 * Meanings used:
 * - Amounts (`tokenBalance`, `currentDeployedAmount`, `externalYieldAmount`) are in
 *   the principal mint's native units, sent as numbers or decimal strings.
 * - `interestPerSecond`: native units per second across the strategy's loans.
 * - `interestFee`, `externalYieldInfo.apy`: CBPS — 1 000 000 = 100%.
 * - `strategySummary.totalSupplyUsd`: the vault's assets in USD (with
 *   `includeStrategySummaries`), used only to price one native unit.
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
  vaultMetadata?: { name?: string | null } | null;
  vaultStrategy?: {
    strategy?: { tokenBalance?: Wire; currentDeployedAmount?: Wire; externalYieldAmount?: Wire; interestPerSecond?: Wire; interestFee?: Wire };
    externalYieldInfo?: { apy?: Wire } | null;
  } | null;
  vaultRewardsSchedules?: { rewardMint?: string; rewardEndTime?: number }[] | null;
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
  const rewards: RewardStream[] = (v.vaultRewardsSchedules ?? [])
    .filter((r) => r.rewardMint)
    .map((r) => ({
      key: `loopscale:${v.vault.address}:${r.rewardMint}`,
      source: 'protocol' as const,
      kind: 'token' as const,
      token: { symbol: null, address: r.rewardMint as string, chain: 'solana:mainnet' },
      // Emissions without a validated price: listed, never counted in dollars.
      aprUsd: null,
      endsAt: r.rewardEndTime ? new Date(r.rewardEndTime * 1000).toISOString() : null,
      conditional: false,
      vesting: false,
    }));
  const paused = !!v.pause?.depositsPaused || v.vault.depositsEnabled === false;
  return {
    key: `loopscale:solana:mainnet:${v.vault.address}:vault`,
    family: 'vault',
    protocol: { id: 'loopscale', version: 'vault', name: 'Loopscale' },
    chain: 'solana:mainnet',
    market: { id: v.vault.address, address: v.vault.address, name: v.vaultMetadata?.name ?? `${symbol ?? '—'} Vault` },
    assets: { deposit: [{ symbol, address: v.vault.principalMint }] },
    rate: { value: apr, kind: 'apr', feesIncluded: true, rewardsIncluded: false, at: fetchedAt },
    maturity: null,
    capacity: { depositRemainingUsd: null, withdrawableNowUsd: v.pause?.withdrawalsPaused ? 0 : (idle + external) * unitUsd },
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

export async function fetchLoopscale(fetchedAt: string): Promise<Opportunity[]> {
  const vaults: LoopscaleVaultInfo[] = [];
  for (let page = 0; page < CFG.maxPages; page++) {
    const d = await withRetry(() => postJson<VaultsPage>(CFG.name, `${CFG.api}/markets/lending_vaults/info`, { page, pageSize: CFG.pageSize, includeStrategySummaries: true, depositsEnabled: true }, isPage));
    vaults.push(...d.lendVaults);
    if (d.hasMore === false || d.lendVaults.length < CFG.pageSize) break;
  }
  const tokens = await fetchSolanaTokens(vaults.map((v) => v.vault?.principalMint).filter(Boolean));
  return vaults
    .map((v) => {
      const t = tokens.get(v.vault?.principalMint);
      const o = loopscaleVault(v, fetchedAt, t?.symbol ?? null);
      return o && t?.icon ? { ...o, icon: t.icon } : o;
    })
    .filter((o): o is Opportunity => o !== null);
}
