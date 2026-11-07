import 'server-only';
import protocols from '../../config/protocols.json';
import type { ExecQuote } from '../../types/opportunity';
export { quoteAmount } from '../opportunity/policy';

/**
 * Executable PT/YT entry prices from Pendle's own router (`/core/v2/sdk/{chain}/convert`):
 * how many PT or YT a dollar amount of the chain's USDC buys right now, and its price
 * impact. Pendle meters the API (200 computing units a minute, about 5 per quote), so
 * quotes are cached for 10 minutes and asked only while the minute's budget lasts.
 */

const BASE = protocols.pendle.apiBase;
const RECEIVER = '0x000000000000000000000000000000000000dEaD';
const QUOTE_TTL_MS = 10 * 60_000;
const INFO_TTL_MS = 5 * 60_000;
const STABLE_TTL_MS = 24 * 3_600_000;
/** Stop asking when fewer computing units than this remain in Pendle's minute window. */
const MIN_REMAINING_CU = 40;
/** A route losing more than this share also tries the market's own input token. */
const POOR_ROUTE = 0.2;
/** A route losing more than this share is broken: no quote. */
const BROKEN_ROUTE = 0.5;

interface Token {
  address: string;
  decimals: number;
}
interface MarketInfo {
  pt: Token;
  yt: Token;
  /** Mid USD prices of one PT and one YT, as Pendle lists them. */
  ptUsd: number | null;
  ytUsd: number | null;
  /** The market's own first input token and its USD price: used when USDC cannot be routed in. */
  input: (Token & { usd: number }) | null;
  /** USD value of the accounting asset one PT redeems for at maturity. */
  unitUsd: number;
}

/** A token Pendle lists on a chain, with its USD price. */
interface Asset extends Token {
  symbol: string;
  usd: number | null;
}
const assets = new Map<number, { list: Asset[]; at: number }>();
const stables = new Map<number, { t: Token | null; at: number }>();
const infos = new Map<string, { i: MarketInfo | null; at: number }>();
const quotes = new Map<string, { q: ExecQuote; at: number }>();
let budget = { remaining: Infinity, resetAt: 0 };

async function pendle<T>(path: string): Promise<T | null> {
  if (Date.now() < budget.resetAt && budget.remaining < MIN_REMAINING_CU) return null;
  try {
    const res = await fetch(`${BASE}${path}`, { headers: { accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    const remaining = Number(res.headers.get('x-ratelimit-remaining'));
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    if (Number.isFinite(remaining) && Number.isFinite(reset)) budget = { remaining, resetAt: reset * 1000 };
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

const isAddr = (a: unknown): a is string => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);

/** Every token Pendle lists on the chain, with its USD price (refreshed with the stable pick). */
async function assetsOf(chainId: number): Promise<Asset[] | null> {
  const hit = assets.get(chainId);
  if (hit && Date.now() - hit.at < INFO_TTL_MS) return hit.list;
  const raw = await pendle<{ address?: string; symbol?: string; decimals?: number; price?: { usd?: number } }[]>(`/v1/${chainId}/assets/all`);
  if (!Array.isArray(raw)) return hit?.list ?? null;
  const list = raw
    .filter((a) => isAddr(a.address) && typeof a.decimals === 'number' && typeof a.symbol === 'string')
    .map((a) => ({ address: (a.address as string).toLowerCase(), decimals: a.decimals as number, symbol: a.symbol as string, usd: typeof a.price?.usd === 'number' && a.price.usd > 0 ? a.price.usd : null }));
  assets.set(chainId, { list, at: Date.now() });
  return list;
}

/** The chain's USDC (else USDT) as Pendle lists it: what a quote sells from. */
async function stableOf(chainId: number): Promise<Token | null> {
  const hit = stables.get(chainId);
  if (hit && Date.now() - hit.at < STABLE_TTL_MS) return hit.t;
  const list = await assetsOf(chainId);
  if (!list) return hit?.t ?? null;
  const pick = (sym: string) => list.find((a) => a.symbol === sym);
  const a = pick('USDC') ?? pick('USDT0') ?? pick('USDT');
  const t = a ? { address: a.address, decimals: a.decimals } : null;
  stables.set(chainId, { t, at: Date.now() });
  return t;
}

async function infoOf(chainId: number, market: string): Promise<MarketInfo | null> {
  const key = `${chainId}:${market}`;
  const hit = infos.get(key);
  if (hit && Date.now() - hit.at < INFO_TTL_MS) return hit.i;
  type T = { address?: string; decimals?: number; price?: { usd?: number } };
  const m = await pendle<{ pt?: T; yt?: T; accountingAsset?: T; inputTokens?: T[] }>(`/v1/${chainId}/markets/${market}`);
  if (!m) return hit?.i ?? null;
  const tok = (t: T | undefined) => (t && isAddr(t.address) && typeof t.decimals === 'number' ? { address: t.address, decimals: t.decimals } : null);
  const pt = tok(m.pt);
  const yt = tok(m.yt);
  const unitUsd = m.accountingAsset?.price?.usd;
  const first = m.inputTokens?.find((t) => tok(t) && typeof t.price?.usd === 'number' && (t.price.usd as number) > 0);
  const input = first ? { ...(tok(first) as Token), usd: first.price!.usd as number } : null;
  const usd = (t: T | undefined) => (typeof t?.price?.usd === 'number' && t.price.usd > 0 ? t.price.usd : null);
  const i = pt && yt && typeof unitUsd === 'number' && unitUsd > 0 ? { pt, yt, ptUsd: usd(m.pt), ytUsd: usd(m.yt), unitUsd, input } : null;
  infos.set(key, { i, at: Date.now() });
  return i;
}

/**
 * `tokenIn`: sell this token instead of USDC (a loop buys its PT with the borrowed token, e.g.
 * USDT — its conversion is part of the entry cost). Only a token Pendle lists with a USD price
 * on that chain is used, sized by that price; anything else falls back to USDC.
 */
export async function pendleQuote(chainId: number, market: string, side: 'pt' | 'yt', usd: number, tokenIn?: string | null): Promise<ExecQuote | null> {
  const m = market.toLowerCase();
  const want = tokenIn?.toLowerCase() ?? null;
  const key = `${chainId}:${m}:${side}:${usd}:${want ?? ''}`;
  const hit = quotes.get(key);
  if (hit && Date.now() - hit.at < QUOTE_TTL_MS) return hit.q;
  const [stable, info, list] = await Promise.all([stableOf(chainId), infoOf(chainId, m), want ? assetsOf(chainId) : Promise.resolve(null)]);
  if (!info) return hit?.q ?? null;
  const given = want ? (list?.find((a) => a.address === want && a.usd !== null) ?? null) : null;
  const out = side === 'pt' ? info.pt : info.yt;
  const raw = (amount: number, decimals: number) => (BigInt(Math.round(amount * 10 ** Math.min(decimals, 6))) * BigInt(10) ** BigInt(Math.max(0, decimals - 6))).toString();
  const convert = async (tokenIn: string, amountIn: string) => {
    const q = new URLSearchParams({ receiver: RECEIVER, slippage: '0.005', tokensIn: tokenIn, amountsIn: amountIn, tokensOut: out.address, enableAggregator: 'true', aggregators: 'kyberswap' });
    const body = await pendle<{ routes?: { outputs?: { token?: string; amount?: string }[]; data?: { priceImpact?: number } }[] }>(`/v2/sdk/${chainId}/convert?${q}`);
    const route = body?.routes?.[0];
    const amount = route?.outputs?.find((o) => o.token?.toLowerCase() === out.address.toLowerCase())?.amount;
    const units = amount ? Number(amount) / 10 ** out.decimals : NaN;
    return units > 0 ? { units, impact: route?.data?.priceImpact } : null;
  };
  // The token asked for, else USDC; some markets only route (or route well) from their own input token, sized by its USD price.
  let got = given ? await convert(given.address, raw(usd / (given.usd as number), given.decimals)) : stable ? await convert(stable.address, raw(usd, stable.decimals)) : null;
  let from = given?.symbol ?? 'USDC';
  if ((!got || (got.impact ?? 0) < -POOR_ROUTE) && info.input) {
    const alt = await convert(info.input.address, raw(usd / info.input.usd, info.input.decimals));
    if (alt && (!got || alt.units > got.units)) {
      got = alt;
      from = list?.find((a) => a.address === info.input!.address.toLowerCase())?.symbol ?? 'ورودی بازار';
    }
  }
  // Losing more than half on entry is a routing failure, not a price: no quote rather than a false loss.
  if (!got || (got.impact ?? 0) < -BROKEN_ROUTE) return hit?.q ?? null;
  const quote: ExecQuote = {
    side,
    usd,
    units: got.units,
    unitUsd: info.unitUsd,
    priceImpactPct: typeof got.impact === 'number' ? Math.abs(got.impact) * 100 : null,
    midUsd: side === 'pt' ? info.ptUsd : info.ytUsd,
    tokenIn: from,
    at: new Date().toISOString(),
    source: 'Pendle',
  };
  quotes.set(key, { q: quote, at: Date.now() });
  return quote;
}
