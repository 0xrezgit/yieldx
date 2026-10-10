import type { ExecQuote } from '../../types/opportunity';
import type { Analysis } from './analysis';
import { NEEDS_QUOTE, NEEDS_QUOTE_IMPLIED } from '../opportunity/estimate';
import { evmChainId } from '../opportunity/costs';
import { quoteAmount } from '../opportunity/policy';

/**
 * Which quotes to ask the router for this amount, most useful first, each kind within its
 * own budget (the router's quota is small):
 * - PT and YT markets that only wait for a quote (too big for the pool to trust the mid
 *   rate) — PT by implied rate, YT by how far the base yield is above it;
 * - then the best-ranked PT and YT, so the figures at the top of the ranking are the
 *   prices actually paid, not the mid rate;
 * - PT loops: their PT at the whole position's size (capital × leverage).
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

type Kind = 'pt' | 'yt' | 'loop';

/** Quotes asked per amount, by kind: those waiting for one, and the best-ranked (30 in all). */
export const QUOTE_BUDGET = { ptWaiting: 6, ptTop: 6, ytWaiting: 5, ytTop: 3, loopWaiting: 4, loopTop: 6 } as const;

export function quoteCandidates(a: Analysis, usd: number, known: Record<string, ExecQuote | null>): QuoteRequest[] {
  const out: { req: QuoteRequest; kind: Kind; tier: number; score: number }[] = [];
  const seen = new Set<string>();
  const add = (req: QuoteRequest, kind: Kind, tier: number, score: number) => {
    if (req.id in known || seen.has(req.id) || !Number.isFinite(score)) return;
    seen.add(req.id);
    out.push({ req, kind, tier, score });
  };
  for (const r of a.rows) {
    const o = r.o;
    const estimates = Object.values(r.byHorizon);
    const bestNet = Math.max(...estimates.filter((e) => e.placement === 'ranked' && e.net !== null).map((e) => e.net as number));
    if (o.family === 'leverage' && o.ptMarket) {
      // The loop's PT at the size it is bought in: equity × leverage.
      // Ranked loops by their net; loops too big for the pool's mid rate first (they wait for it).
      const e = estimates.filter((x) => x.leverage && x.net !== null).sort((x, y) => (y.net as number) - (x.net as number))[0];
      const waiting = estimates.find((x) => x.quoteUsd);
      const size = quoteAmount(waiting?.quoteUsd ?? e?.leverage?.gross ?? 0);
      if (size >= 100) add({ id: quoteId(o.ptMarket.key, size), chain: o.ptMarket.chainId, market: o.ptMarket.address, side: 'pt', usd: size }, 'loop', waiting ? 0 : 1, waiting ? (o.loop?.collateral.yield.pct ?? 0) : (e!.net as number));
      continue;
    }
    if ((o.family !== 'pt' && o.family !== 'yt') || o.protocol.id !== 'pendle' || !o.market.address) continue;
    const chain = evmChainId(o.chain);
    if (chain === null) continue;
    const req = { id: quoteId(o.key, usd), chain, market: o.market.address, side: o.family, usd } as QuoteRequest;
    if (estimates.some((e) => e.reason === NEEDS_QUOTE || e.reason?.startsWith(NEEDS_QUOTE_IMPLIED))) {
      add(req, o.family, 0, o.family === 'pt' ? (o.rate.value ?? -Infinity) : (o.rate.value ?? -Infinity) - (o.yt?.impliedPct ?? Infinity));
    } else if (Number.isFinite(bestNet) && bestNet > 0) add(req, o.family, 1, bestNet);
  }
  // Each kind and tier within its own share of the budget, so markets that only wait for a quote
  // never use up the quotes of the best-ranked rows (Pendle meters about 40 quotes a minute).
  const pick = (kind: Kind, tier: number, n: number) =>
    out
      .filter((x) => x.kind === kind && x.tier === tier)
      .sort((x, y) => y.score - x.score)
      .slice(0, n)
      .map((x) => x.req);
  const B = QUOTE_BUDGET;
  return [...pick('pt', 0, B.ptWaiting), ...pick('pt', 1, B.ptTop), ...pick('yt', 0, B.ytWaiting), ...pick('yt', 1, B.ytTop), ...pick('loop', 0, B.loopWaiting), ...pick('loop', 1, B.loopTop)];
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
