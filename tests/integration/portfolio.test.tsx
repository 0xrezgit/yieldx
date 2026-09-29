import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }), usePathname: () => '/portfolio' }));

import type { Position, PositionEvent } from '../../src/types/position';
import { emptyManual, emptyTargets } from '../../src/types/position';
import { valuePosition, type MarketQuote } from '../../src/lib/portfolio/valuation';
import { analyzePosition, positionAlerts } from '../../src/lib/portfolio/analysis';
import type { PositionView } from '../../src/hooks/usePortfolioView';
import { PositionTable } from '../../src/components/portfolio/Portfolio';
import { AnalysisPanel, Answers, KindPanel, Numbers } from '../../src/components/portfolio/PositionDetail';
import NewPosition from '../../src/components/portfolio/NewPosition';
import { Pnl } from '../../src/components/portfolio/parts';
import { EventFields, emptyDraft } from '../../src/components/portfolio/EventForm';

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
      renderToString(<PositionTable views={[x]} />),
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

  it.each(['pt', 'yt', 'loop'] as const)('%s: amounts read «دلار» with Persian digits — no $ and no Latin digits in visible text', (kind) => {
    const x = view(base(kind));
    const html = [<PositionTable key="c" views={[x]} />, <Answers key="a" x={x} />, <Numbers key="n" x={x} />, <KindPanel key="k" x={x} onSave={() => {}} />, <AnalysisPanel key="p" x={x} />]
      .map((el) => renderToString(el))
      .join('');
    // Visible text only: drop tags (with their attributes) and comments.
    const text = html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ');
    expect(text).not.toContain('$');
    expect(text).toContain('دلار');
    // Official symbols keep Latin letters; digits must all be Persian.
    expect(text.match(/[0-9]/g)).toBeNull();
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

  it('event form offers a token picker with the chosen token logo', () => {
    const d = { ...emptyDraft('buy', 'USDG'), fees: [{ kind: 'network' as const, amount: 0.001, token: 'ETH', usdRate: NaN, rateSource: 'unknown' as const, included: false }] };
    const html = renderToString(<EventFields draft={d} onChange={() => {}} assetSymbol="USDe" liveAssetUsd={1} types={['buy']} chain="Ethereum" />);
    expect(html).toContain('رمزارز پرداختی');
    expect(html).toContain('USDG');
    expect(html).toContain('coin-images.coingecko.com');
    expect(html).toContain('رمزارز کارمزد');
  });

  it('wizard starts at platform choice', () => {
    const html = renderToString(<NewPosition />);
    expect(html).toContain('پلتفرم را انتخاب کنید');
    expect(html).toContain('Pendle');
  });
});

describe('matured section render', () => {
  it('summarises a position past maturity in Persian', async () => {
    const { MaturedSection } = await import('../../src/components/portfolio/Portfolio');
    const { valuePosition } = await import('../../src/lib/portfolio/valuation');
    const { emptyManual, emptyTargets } = await import('../../src/types/position');
    const { renderToString } = await import('react-dom/server');
    const { assertPersianMoney } = await import('../helpers/text');
    const now = Date.UTC(2026, 5, 1);
    const p = {
      id: 'm1', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', kind: 'pt' as const, protocol: 'pendle' as const, chain: 'Ethereum',
      marketId: '1-0xabc', marketName: 'sUSDe', platform: 'Ethena', icon: '', maturity: '2026-05-01T00:00:00.000Z', assetSymbol: 'USDe',
      events: [
        { id: 'b', type: 'buy' as const, at: '2026-01-02T10:00:00.000Z', units: 1000, cash: { amount: 950, token: 'USDC', usdRate: 1, rateSource: 'manual' as const }, assetUsd: 1, assetUsdSource: 'manual' as const, fees: [], note: '' },
      ],
      loop: null, manual: emptyManual(), targets: emptyTargets(), points: { perDay: 0, multiplier: 1, basis: 'unit' as const, valuePerPoint: 0 }, snapshots: [], note: '',
    };
    const v = valuePosition(p, null, now);
    const html = renderToString(<MaturedSection views={[{ p, v, a: {} as never, alerts: [], quote: null, q: undefined }]} />);
    expect(html).toContain('پوزیشن‌های سررسیدشده');
    expect(html).toContain('تاریخ ورود');
    expect(html).toContain('USDC');
    expect(html).toContain('تخمینی');
    assertPersianMoney(html.replace(/title="[^"]*"/g, '').replace(/href="[^"]*"/g, ''));
  });
});
