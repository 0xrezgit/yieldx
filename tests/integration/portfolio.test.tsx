import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/portfolio' }));

import type { Position, PositionEvent } from '../../src/types/position';
import { emptyManual, emptyTargets } from '../../src/types/position';
import { valuePosition, type MarketQuote } from '../../src/lib/portfolio/valuation';
import { analyzePosition, positionAlerts } from '../../src/lib/portfolio/analysis';
import type { PositionView } from '../../src/hooks/usePortfolioView';
import { PositionCard } from '../../src/components/portfolio/Portfolio';
import { AnalysisPanel, Answers, KindPanel, Numbers } from '../../src/components/portfolio/PositionDetail';
import NewPosition from '../../src/components/portfolio/NewPosition';
import { Pnl } from '../../src/components/portfolio/parts';

const now = Date.now();
const ev = (type: PositionEvent['type'], units: number, amount: number): PositionEvent => ({
  id: type,
  type,
  at: new Date(now - 30 * 86_400_000).toISOString(),
  units,
  cash: { amount, token: 'USDC', usdRate: 1, rateSource: 'manual' },
  assetUsd: 1,
  assetUsdSource: 'manual',
  fees: [{ kind: 'network', amount: 2, token: 'USDC', usdRate: 1, rateSource: 'manual', included: false }],
  note: '',
});

const base = (kind: Position['kind']): Position => ({
  id: kind,
  createdAt: new Date(now).toISOString(),
  updatedAt: new Date(now).toISOString(),
  kind,
  protocol: 'pendle',
  chain: 'Arbitrum',
  marketId: '42161-0x0000000000000000000000000000000000000001',
  marketName: 'sUSDe',
  platform: 'Ethena',
  icon: '',
  maturity: new Date(now + 90 * 86_400_000).toISOString(),
  assetSymbol: 'USDe',
  events: kind === 'loop' ? [ev('borrow', 0, 2000), ev('buy', 3100, 3000)] : kind === 'yt' ? [ev('buy', 20_000, 500)] : [ev('buy', 1000, 950)],
  loop:
    kind === 'loop'
      ? { lendingPlatform: 'Morpho', lendingMarket: 'PT-sUSDe/USDC', debtAsset: 'USDC', debtIsAccountingAsset: true, debtAssetUsd: null, borrowAPY: 8, lltv: 86, oracle: 'unknown', oraclePtPrice: null, debtOverride: null }
      : null,
  manual: emptyManual(),
  targets: { ...emptyTargets(), takeProfitPct: 1 },
  points: { perDay: 1, multiplier: 2, basis: 'unit', valuePerPoint: 0.01 },
  snapshots: [],
  note: '',
});

const quote: MarketQuote = { ptPrice: 0.97, ytPrice: 0.03, assetUsd: 1, impliedAPY: 9, baseAPY: 11, liquidity: 20_000_000, fetchedAt: new Date(now).toISOString(), history: null };

const view = (p: Position, q: MarketQuote | null = quote): PositionView => {
  const v = valuePosition(p, q, now);
  return { p, v, a: analyzePosition(p, v, q), alerts: positionAlerts(p, v), quote: q, q: undefined };
};

describe('portfolio render', () => {
  it.each(['pt', 'yt', 'loop'] as const)('%s position renders every panel', (kind) => {
    const x = view(base(kind));
    const html = [
      renderToString(<PositionCard x={x} />),
      renderToString(<Answers x={x} />),
      renderToString(<Numbers x={x} />),
      renderToString(<KindPanel x={x} onSave={() => {}} />),
      renderToString(<AnalysisPanel x={x} />),
    ].join('');
    expect(html).toContain('چه خریده‌ام؟');
    expect(html).toContain('اگر اکنون خارج شوم؟');
    expect(html).toContain('تخمینی');
    if (kind === 'loop') expect(html).toContain('شاخص سلامت');
    if (kind === 'yt') expect(html).toContain('خارج از سود و زیان');
    if (kind === 'pt') expect(html).toContain('PT معادل یک دلار فرض نشده');
  });

  it('shows missing prices as unavailable, not live', () => {
    const x = view(base('pt'), null);
    const html = renderToString(<Numbers x={x} />);
    expect(html).toContain('ناموجود');
  });

  it('P&L carries a word and icon besides colour', () => {
    expect(renderToString(<Pnl usd={-5} />)).toContain('زیان');
    expect(renderToString(<Pnl usd={5} />)).toContain('سود');
  });

  it('wizard starts at platform choice', () => {
    const html = renderToString(<NewPosition />);
    expect(html).toContain('پلتفرم را انتخاب کنید');
    expect(html).toContain('Pendle');
  });
});
