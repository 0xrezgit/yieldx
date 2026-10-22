import lending from '../../config/lending.json';
import type { Opportunity } from '../../types/opportunity';
import { fetchJson, isArrayOf, postJson } from '../protocols/base';
import { networkByChainId } from '../registry/networks';
import { pathSlug } from '../market/links';
import { tokenInfo } from '../portfolio/tokens';
import { eulerTokenLogo } from './euler';

/**
 * Upshift vaults (built on August Digital), from Upshift's public vault list
 * GET /api/v1/tokenized_vault. Its rates are realised: the share price over the last
 * 1, 7 and 30 days, compounded (`historical_compound_apy`, the «Total APY (30D)» its
 * app shows) — after the vault's fees, since they come out of the share price.
 *
 * The list has no deposit asset: each vault is an ERC-4626, so `asset()` is read from
 * the vault and `symbol()` from the asset (one JSON-RPC batch per network). Only visible,
 * active vaults that still take deposits, on the networks with an RPC here.
 */

const CFG = lending.upshift;
const RPCS = CFG.rpc as Record<string, string>;

export interface UpshiftVault {
  address: string;
  chain: number;
  vault_name: string;
  status?: string;
  is_visible?: boolean;
  withdrawal_only?: boolean;
  public_type?: string;
  internal_type?: string;
  receipt_token_symbol?: string;
  vault_logo_url?: string | null;
  tvl?: number | null;
  historical_compound_apy?: Record<string, number> | null;
  hardcoded_strategists?: { strategist_name?: string | null }[] | null;
  platform_fee_override?: { management_fee?: number | null } | null;
  weekly_performance_fee_bps?: number | null;
  rewards?: string | { text?: string; multiplier?: number }[] | null;
  metrics_last_updated?: string | null;
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/** Points programs: a list, or the same list as Python-style text («'text': 'Upshift Points', 'multiplier': 5.0»). */
export function pointsOf(rewards: UpshiftVault['rewards']): { name: string; multiplier: number }[] {
  if (Array.isArray(rewards)) return rewards.flatMap((r) => (r.text && fin(r.multiplier) ? [{ name: r.text, multiplier: r.multiplier }] : []));
  if (typeof rewards !== 'string') return [];
  return [...rewards.matchAll(/'text':\s*'([^']+)',\s*'multiplier':\s*([\d.]+)/g)].map((m) => ({ name: m[1], multiplier: Number(m[2]) }));
}

/** An ABI-encoded string (or a bytes32 one, as some old tokens return). */
export function decodeString(hex: string): string | null {
  const h = hex.replace(/^0x/, '');
  if (h.length === 64) return Buffer.from(h, 'hex').toString('utf8').replace(/\0+$/, '') || null;
  if (h.length < 128) return null;
  const len = parseInt(h.slice(64, 128), 16);
  return len > 0 && len < 100 ? Buffer.from(h.slice(128, 128 + len * 2), 'hex').toString('utf8') : null;
}

type RpcReply = { id: number; result?: string; error?: unknown };

async function ethCalls(rpc: string, calls: { to: string; data: string }[]): Promise<(string | null)[]> {
  if (!calls.length) return [];
  const body = calls.map((c, id) => ({ jsonrpc: '2.0', id, method: 'eth_call', params: [{ to: c.to, data: c.data }, 'latest'] }));
  const replies = await postJson<RpcReply[]>(CFG.name, rpc, body, (b): b is RpcReply[] => Array.isArray(b));
  const byId = new Map(replies.map((r) => [r.id, r.result && r.result !== '0x' ? r.result : null]));
  return calls.map((_, i) => byId.get(i) ?? null);
}

const ASSET = '0x38d52e0f';
const SYMBOL = '0x95d89b41';

/** Each vault's deposit asset (address and symbol), read on its network. */
async function assetsOf(vaults: UpshiftVault[]): Promise<Map<string, { address: string; symbol: string }>> {
  const out = new Map<string, { address: string; symbol: string }>();
  const byChain = new Map<number, UpshiftVault[]>();
  for (const v of vaults) byChain.set(v.chain, [...(byChain.get(v.chain) ?? []), v]);
  // One network's RPC failing leaves only its vaults out.
  await Promise.allSettled(
    [...byChain].map(async ([chain, list]) => {
      const rpc = RPCS[String(chain)];
      const assets = await ethCalls(rpc, list.map((v) => ({ to: v.address, data: ASSET })));
      const addrs = assets.map((a) => (a && a.length >= 66 ? `0x${a.slice(-40)}` : null));
      const unique = [...new Set(addrs.filter((a): a is string => a !== null))];
      const symbols = await ethCalls(rpc, unique.map((a) => ({ to: a, data: SYMBOL })));
      const symbolOf = new Map(unique.map((a, i) => [a, symbols[i] ? decodeString(symbols[i] as string) : null]));
      list.forEach((v, i) => {
        const a = addrs[i];
        const s = a ? symbolOf.get(a) : null;
        if (a && s) out.set(v.address.toLowerCase(), { address: a, symbol: s });
      });
    }),
  );
  return out;
}

export const upshiftUrl = (v: Pick<UpshiftVault, 'chain' | 'vault_name'>) => `${CFG.app}/vaults/${pathSlug(networkByChainId(v.chain).name)}/${pathSlug(v.vault_name)}`;

export function upshiftOpportunity(v: UpshiftVault, asset: { address: string; symbol: string }, fetchedAt: string): Opportunity | null {
  const apy = v.historical_compound_apy ?? {};
  const a30 = fin(apy['30']) ? apy['30'] * 100 : null;
  const a7 = fin(apy['7']) ? apy['7'] * 100 : null;
  const rate = a30 ?? a7;
  if (rate === null || rate > 1000) return null;
  const network = networkByChainId(v.chain);
  const strategist = v.hardcoded_strategists?.[0]?.strategist_name ?? null;
  const points = pointsOf(v.rewards);
  const mgmt = v.platform_fee_override?.management_fee;
  return {
    key: `upshift:${network.key}:${v.address.toLowerCase()}:vault`,
    family: 'vault',
    protocol: { id: 'upshift', version: v.internal_type ?? 'vault', name: 'Upshift' },
    chain: network.key,
    market: { id: v.address, address: v.address, name: `${v.vault_name}${strategist ? ` · ${strategist}` : ''}` },
    assets: { deposit: [asset] },
    rate: { value: rate, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: v.metrics_last_updated ? new Date(`${v.metrics_last_updated.replace(/Z?$/, 'Z')}`).toISOString() : fetchedAt, ...(a7 !== null ? { avg7d: a7 } : {}) },
    maturity: null,
    capacity: { depositRemainingUsd: null, withdrawableNowUsd: null },
    exit: { type: 'queue', note: 'برداشت با درخواست انجام می‌شود و در صف خزانه پردازش می‌شود؛ زمان آن در API نیامده.' },
    rewards: [],
    risk: { oracle: null, curator: strategist, paused: false, incidents: [] },
    // Realised from the share price over 30 days, not a forward rate.
    quality: 'partial',
    sources: [{ name: 'Upshift API', url: `${CFG.api}/tokenized_vault`, fetchedAt, sourceUpdatedAt: v.metrics_last_updated ?? null }],
    notes: [
      `خزانه‌ی Upshift${v.public_type ? ` (${v.public_type})` : ''}${strategist ? ` با استراتژیست ${strategist}` : ''}؛ نرخ، بازده تحقق‌یافته‌ی ۳۰ روز گذشته از قیمت سهم است (پس از کارمزدها)، نه نرخ آینده.`,
      ...(fin(mgmt) && mgmt > 0 ? [`کارمزد مدیریت ${mgmt}٪ در سال.`] : []),
      ...(points.length ? [`پوینت: ${points.map((p) => `${p.name} ×${p.multiplier}`).join('، ')} — بدون ارزش دلاری، در سود حساب نشده.`] : []),
    ],
    url: upshiftUrl(v),
    // Upshift's list has no token logos: a well-known token's, the vault's own, or Euler's token image service.
    icon: tokenInfo(asset.symbol)?.logo ?? (v.vault_logo_url || null) ?? (lending.euler.chains.includes(v.chain) ? eulerTokenLogo(v.chain, asset.address) : null),
  };
}

export async function fetchUpshift(fetchedAt: string): Promise<Opportunity[]> {
  const all = await fetchJson<UpshiftVault[]>(CFG.name, `${CFG.api}/tokenized_vault`, isArrayOf<UpshiftVault>, 120_000);
  const vaults = all.filter((v) => v.is_visible && v.status === 'active' && !v.withdrawal_only && RPCS[String(v.chain)] && fin(v.tvl) && v.tvl >= CFG.minTvlUsd && /^0x[0-9a-fA-F]{40}$/.test(v.address));
  const assets = await assetsOf(vaults);
  return vaults.flatMap((v) => {
    const a = assets.get(v.address.toLowerCase());
    const o = a ? upshiftOpportunity(v, a, fetchedAt) : null;
    return o ? [o] : [];
  });
}
