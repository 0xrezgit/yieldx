import lending from '../../config/lending.json';
import type { DataQuality, Opportunity } from '../../types/opportunity';
import { networkByChainId } from '../registry/networks';
import { fetchJson, isObject, mapLimit, postJson } from '../protocols/base';
import { kinkedSupplyCurve } from '../opportunity/curve';

/**
 * Revert Lend — supplying USDC to a Revert V3Vault (ERC-4626; borrowers post
 * Uniswap V3 / Aerodrome LP positions as collateral). Sources:
 *
 * - Rate: Revert's API `/lend/daily-rates?network=` — one `lend_apr` per day (%,
 *   simple). Today's value is the rate; the last 7 days give the average.
 * - Everything else is read from the vault itself (public RPC, read-only calls):
 *   `vaultInfo()` → (debt, lent, available, reserves, debtExchangeRateX96,
 *   lendExchangeRateX96) in USDC base units — checked live: lent − debt + reserves =
 *   available = the vault's USDC balance; lenders can take out available − reserves.
 *   `globalLendLimit()` and `dailyLendIncreaseLimitLeft()` bound new deposits.
 *   The interest-rate model (`interestRateModel()`: base, multiplier, jump multiplier
 *   per second ×2⁶⁴, kink ×2⁶⁴) and `reserveFactorX32()` give the supply curve for the
 *   rate after the user's deposit.
 * - `asset()` must be the vault's configured USDC; otherwise the vault is skipped.
 *
 * Checked 2026-10-05: the model's rate at today's utilization (4.0 / 5.4 / 4.7 %) sits
 * just under the API's daily figure (4.3 / 5.9 / 5.0 %), which averages the day.
 */

const CFG = lending.revert;
const X64 = 2 ** 64;
const YEAR_S = 365 * 86_400;
const USDC: Record<number, string> = {
  1: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  42161: '0xaf88d065e77c8cc2239327c5edb3a432268e5831',
  8453: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
};
/** A daily rate older than this makes the row stale. */
const MAX_RATE_AGE_DAYS = 2;

const SEL = {
  vaultInfo: '0x501ec738',
  globalLendLimit: '0xbe757d06',
  dailyLendIncreaseLimitLeft: '0x8518da61',
  interestRateModel: '0xf3fdb15a',
  reserveFactorX32: '0x879f4130',
  asset: '0x38d52e0f',
  baseRatePerSecondX64: '0xedcc8a5d',
  multiplierPerSecondX64: '0x53de9f52',
  jumpMultiplierPerSecondX64: '0xc9e8a6fa',
  kinkX64: '0x153f54cc',
} as const;

type Vault = (typeof CFG.vaults)[number];

interface RpcReply {
  id: number;
  result?: string;
  error?: unknown;
}

/** Several read-only calls in one JSON-RPC batch; any failure fails the vault. */
async function ethCalls(rpc: string, calls: { to: string; data: string }[]): Promise<string[]> {
  const body = calls.map((c, id) => ({ jsonrpc: '2.0', id, method: 'eth_call', params: [{ to: c.to, data: c.data }, 'latest'] }));
  const replies = await postJson<RpcReply[]>(CFG.name, rpc, body, (b): b is RpcReply[] => Array.isArray(b));
  return calls.map((_, id) => {
    const r = replies.find((x) => x.id === id);
    if (!r?.result || r.result === '0x') throw new Error(`eth_call ${id} failed`);
    return r.result;
  });
}

const words = (hex: string) => (hex.slice(2).match(/.{64}/g) ?? []).map((w) => BigInt(`0x${w}`));
const word = (hex: string) => words(hex)[0] ?? BigInt(0);
const usdc = (x: bigint) => Number(x) / 1e6;
const address = (hex: string) => `0x${hex.slice(-40)}`.toLowerCase();

export interface RevertVaultState {
  debt: number;
  lent: number;
  available: number;
  reserves: number;
  lendLimit: number;
  dailyLeft: number;
  /** Yearly fractions. */
  irm: { base: number; multiplier: number; jump: number; kink: number };
  reserveFactor: number;
  asset: string;
}

export async function readVault(v: Vault): Promise<RevertVaultState> {
  const [info, limit, daily, irmHex, rf, asset] = await ethCalls(v.rpc, [
    { to: v.address, data: SEL.vaultInfo },
    { to: v.address, data: SEL.globalLendLimit },
    { to: v.address, data: SEL.dailyLendIncreaseLimitLeft },
    { to: v.address, data: SEL.interestRateModel },
    { to: v.address, data: SEL.reserveFactorX32 },
    { to: v.address, data: SEL.asset },
  ]);
  const irm = address(irmHex);
  const [base, mult, jump, kink] = await ethCalls(v.rpc, [
    { to: irm, data: SEL.baseRatePerSecondX64 },
    { to: irm, data: SEL.multiplierPerSecondX64 },
    { to: irm, data: SEL.jumpMultiplierPerSecondX64 },
    { to: irm, data: SEL.kinkX64 },
  ]);
  const [debt, lent, available, reserves] = words(info);
  const perYear = (h: string) => (Number(word(h)) / X64) * YEAR_S;
  return {
    debt: usdc(debt),
    lent: usdc(lent),
    available: usdc(available),
    reserves: usdc(reserves),
    lendLimit: usdc(word(limit)),
    dailyLeft: usdc(word(daily)),
    irm: { base: perYear(base), multiplier: perYear(mult), jump: perYear(jump), kink: Number(word(kink)) / X64 },
    reserveFactor: Number(word(rf)) / 2 ** 32,
    asset: address(asset),
  };
}

interface DailyRate {
  time: string;
  lend_apr: number | null;
}

async function dailyRates(network: string): Promise<DailyRate[]> {
  const body = await fetchJson<{ data?: DailyRate[] }>(CFG.name, `${CFG.api}/lend/daily-rates?network=${encodeURIComponent(network)}`, isObject);
  return (Array.isArray(body.data) ? body.data : []).filter((d) => typeof d.time === 'string' && typeof d.lend_apr === 'number' && Number.isFinite(d.lend_apr));
}

/** One vault → a lending row; null when the vault is not the configured USDC vault. */
export function revertOpportunity(v: Vault, s: RevertVaultState, rates: DailyRate[], fetchedAt: string, now: number): Opportunity | null {
  if (s.asset !== USDC[v.chainId]) return null;
  const network = networkByChainId(v.chainId);
  const last = rates.at(-1) ?? null;
  const week = rates.slice(-7).map((d) => d.lend_apr as number);
  const ageDays = last ? (now - Date.parse(`${last.time}T00:00:00Z`)) / 86_400_000 : Infinity;
  // Compound-style jump model → the shared two-slope curve (slopes are the rise up to and past the kink).
  const { base, multiplier, jump, kink } = s.irm;
  const points =
    kink > 0 && kink < 1 ? kinkedSupplyCurve({ base, slope1: multiplier * kink, slope2: jump * (1 - kink), optimal: kink, fee: s.reserveFactor }) : [];
  const quality: DataQuality = !last ? 'insufficient' : ageDays > MAX_RATE_AGE_DAYS ? 'stale' : 'current';
  const room = Math.max(0, Math.min(s.lendLimit - s.lent, s.dailyLeft));
  return {
    key: `revert:${network.key}:${v.address.toLowerCase()}:supply`,
    family: 'lend',
    protocol: { id: 'revert', version: 'lend', name: 'Revert Lend' },
    chain: network.key,
    market: { id: v.address, address: v.address, name: 'USDC · وثیقه پوزیشن‌های LP' },
    assets: { deposit: [{ symbol: 'USDC', address: s.asset }] },
    rate: { value: last ? (last.lend_apr as number) : null, kind: 'apr', compoundsPerYear: null, feesIncluded: true, rewardsIncluded: false, at: last ? `${last.time}T00:00:00Z` : null, avg7d: week.length ? week.reduce((a, b) => a + b, 0) / week.length : null, avg1d: last?.lend_apr ?? null },
    maturity: null,
    capacity: { depositRemainingUsd: room, withdrawableNowUsd: Math.max(0, s.available - s.reserves) },
    exit: { type: 'instant', note: 'برداشت فوری تا سقف نقدینگی آزاد خزانه؛ در استفاده‌ی بالا ممکن است موقتاً کم باشد.' },
    rewards: [],
    supplyCurve: points.length && s.lent > 0 ? { suppliedUsd: s.lent, borrowedUsd: s.debt, points, source: 'مدل نرخ بهره‌ی خزانه‌ی Revert (خوانده از قرارداد)' } : null,
    risk: { oracle: null, curator: null, paused: false, incidents: [] },
    quality,
    sources: [
      { name: 'Revert API', url: `${CFG.api}/lend/daily-rates?network=${v.network}`, fetchedAt, sourceUpdatedAt: last ? `${last.time}T00:00:00Z` : null },
      { name: `قرارداد خزانه (${network.name})`, url: null, fetchedAt, sourceUpdatedAt: fetchedAt },
    ],
    notes: [
      'نرخ وام‌دهی روزانه‌ی Revert (ساده، بدون پاداش)؛ سود از بهره‌ی وام‌گیرندگان به USDC.',
      'وام‌گیرندگان پوزیشن‌های LP (Uniswap V3 / Aerodrome) را وثیقه می‌گذارند؛ ریسک نقدشدن وثیقه با خزانه است.',
    ],
    url: CFG.app,
  };
}

export async function fetchRevert(fetchedAt: string, now = Date.parse(fetchedAt)): Promise<Opportunity[]> {
  const results = await mapLimit(CFG.vaults, 3, async (v) => {
    const [state, rates] = await Promise.all([readVault(v), dailyRates(v.network)]);
    return revertOpportunity(v, state, rates, fetchedAt, now);
  });
  const ok = results.flatMap((r) => (r.status === 'fulfilled' && r.value ? [r.value] : []));
  if (!ok.length) throw new Error('Revert Lend: no vault answered');
  return ok;
}
