import type { ExecQuote } from '../../types/opportunity';
import type { Analysis } from './analysis';
import { NEEDS_QUOTE } from '../opportunity/estimate';
import { evmChainId } from '../opportunity/costs';
import { MAX_QUOTES_PER_SIDE } from '../opportunity/policy';

/**
 * Which PT and YT markets to ask the router about for this amount: Pendle markets that
 * only wait for an executable quote (too big for the pool to trust the mid rate), the
 * most promising first — PT by implied rate, YT by how far the base yield is above it.
 */

export interface QuoteRequest {
  /** `${opportunity key}|${usd}` — how a quote is stored and found again. */
  id: string;
  chain: number;
  market: string;
  side: 'pt' | 'yt';
  usd: number;
}

export const quoteId = (key: string, usd: number) => `${key}|${usd}`;

export function quoteCandidates(a: Analysis, usd: number, known: Record<string, ExecQuote | null>): QuoteRequest[] {
  const out: { req: QuoteRequest; score: number }[] = [];
  for (const r of a.rows) {
    const o = r.o;
    if ((o.family !== 'pt' && o.family !== 'yt') || o.protocol.id !== 'pendle' || !o.market.address) continue;
    if (!Object.values(r.byHorizon).some((e) => e.reason === NEEDS_QUOTE)) continue;
    const chain = evmChainId(o.chain);
    const id = quoteId(o.key, usd);
    if (chain === null || id in known) continue;
    const score = o.family === 'pt' ? (o.rate.value ?? -Infinity) : (o.rate.value ?? -Infinity) - (o.yt?.impliedPct ?? Infinity);
    out.push({ req: { id, chain, market: o.market.address, side: o.family, usd }, score });
  }
  const pick = (side: 'pt' | 'yt') =>
    out
      .filter((x) => x.req.side === side && Number.isFinite(x.score))
      .sort((x, y) => y.score - x.score)
      .slice(0, MAX_QUOTES_PER_SIDE)
      .map((x) => x.req);
  return [...pick('pt'), ...pick('yt')];
}

/** One quote from the server; null when the router has none (or the quota is spent). */
export async function fetchQuote(q: QuoteRequest): Promise<ExecQuote | null> {
  try {
    const res = await fetch(`/api/quote?${new URLSearchParams({ chain: String(q.chain), market: q.market, side: q.side, usd: String(q.usd) })}`);
    if (!res.ok) return null;
    return (await res.json()) as ExecQuote;
  } catch {
    return null;
  }
}
