import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { YtBoard } from '../../src/components/opportunities/YtBoard';
import { PtBoard } from '../../src/components/opportunities/PtBoard';
import { LoopBoard } from '../../src/components/opportunities/LoopBoard';
import { CalculatorPanel, defaultCalc, type CalcState } from '../../src/components/opportunities/Calculator';
import { defaultLoopSettings, defaultScreenSettings, type OpportunityListing } from '../../src/lib/risk/opportunities';

const row = (over: Partial<OpportunityListing>): OpportunityListing => ({
  protocol: 'pendle',
  id: 'a',
  name: 'sUSDx',
  platform: 'X',
  icon: null,
  chain: 'Ethereum',
  maturity: '2027-01-01',
  impliedAPY: 10,
  baseAPY: 12,
  liquidity: 5_000_000,
  hasPoints: true,
  ytMultiplier: null,
  points: null,
  categories: ['stables', 'pt-looping'],
  isNew: false,
  expired: false,
  daysToMaturity: 90,
  ...over,
});

const markets = [
  row({}),
  row({ id: 'b', protocol: 'exponent', name: 'ONyc', impliedAPY: 14, baseAPY: 9, points: { name: 'Onyx', pointsPerDay: 2, basis: 'usd', ytMultiplier: 3, lpMultiplier: 1, season: 2 } }),
  row({ id: 'c', name: 'weETH', impliedAPY: 3, baseAPY: 30, categories: ['eth'] }),
];
const noop = () => {};

describe('opportunities render', () => {
  it('boards list markets with limits and zones', () => {
    const yt = renderToString(<YtBoard markets={markets} s={defaultScreenSettings} onCalc={noop} />);
    expect(yt).toContain('پوینت رایگان');
    expect(yt).toContain('Onyx');
    expect(yt).toContain('فصل');
    expect(yt).toContain('موقت');
    const pt = renderToString(<PtBoard markets={markets} s={defaultScreenSettings} onCalc={noop} />);
    expect(pt).toContain('لیمیت خرید پیشنهادی');
    const loop = renderToString(<LoopBoard markets={markets} s={defaultScreenSettings} l={defaultLoopSettings} setL={noop} onCalc={noop} />);
    expect(loop).toContain('در لیست لوپ پندل');
  });

  it.each<Partial<CalcState>>([
    { mode: 'yt' },
    { mode: 'yt', holdDays: 500, valuePerMillion: 50 },
    { mode: 'yt', baseAPY: 0 },
    { mode: 'pt' },
    { mode: 'pt', holdDays: 120 },
    { mode: 'loop' },
    { mode: 'loop', leverage: 20 },
    { mode: 'loop', borrowAPY: 40 },
    { mode: 'yt', capital: 0 },
  ])('calculator renders %o', (over) => {
    const html = renderToString(<CalculatorPanel c={{ ...defaultCalc, ...over }} set={noop} markets={markets} onPick={noop} loadingMarket={false} />);
    expect(html.length).toBeGreaterThan(1000);
    expect(html).not.toContain('NaN');
  });
});

describe('leaderboard render', () => {
  it.each(['pt', 'yt', 'loop'] as const)('renders the four %s buckets', async (strategy) => {
    const { LeaderBoard, defaultRankSettings } = await import('../../src/components/opportunities/LeaderBoard');
    const html = renderToString(
      <LeaderBoard
        markets={markets}
        s={defaultScreenSettings}
        r={{ ...defaultRankSettings, strategy, capital: 10_000 }}
        setR={noop}
        loop={defaultLoopSettings}
        setLoop={noop}
        onCalc={noop}
      />,
    );
    for (const t of ['بیشترین سود', 'کمترین سود', 'بیشترین ضرر', 'کمترین ضرر']) expect(html).toContain(t);
    expect(html).not.toContain('NaN');
  });
});
