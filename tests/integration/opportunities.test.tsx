import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { assertPersianMoney } from '../helpers/text';
import { YtBoard } from '../../src/components/opportunities/YtBoard';
import { CalculatorPanel, defaultCalc, type CalcState } from '../../src/components/opportunities/Calculator';
import { defaultScreenSettings, type OpportunityListing } from '../../src/lib/risk/opportunities';

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
  it('the YT board lists markets with limits and zones', () => {
    const yt = renderToString(<YtBoard markets={markets} s={defaultScreenSettings} onCalc={noop} />);
    expect(yt).toContain('پوینت رایگان');
    expect(yt).toContain('Onyx');
    expect(yt).toContain('فصل');
    expect(yt).toContain('موقت');
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
    assertPersianMoney(html);
  });
});

describe('calculator data checks (NVDAc case)', () => {
  // Real Spectra row: no base APY, $27 of liquidity, 63 days left.
  const nvda = row({ id: 'nv', protocol: 'spectra', name: 'NVDAc', chain: 'Base', impliedAPY: 0.45, baseAPY: null, liquidity: 27.28, daysToMaturity: 63, hasPoints: false, categories: ['stock'] });

  it('explains why the market is not ranked', async () => {
    const { rankingExclusions } = await import('../../src/lib/risk/opportunities');
    const reasons = rankingExclusions(nvda, defaultScreenSettings).join(' ');
    expect(reasons).toContain('نقدینگی');
    expect(reasons).toContain('بازده پایه');
    expect(rankingExclusions(markets[0], defaultScreenSettings)).toEqual([]);
  });

  it('warns about an absurd base APY and a market too thin for the capital', () => {
    const html = renderToString(
      <CalculatorPanel
        c={{ ...defaultCalc, mode: 'yt', protocol: 'spectra', marketId: 'nv', marketName: 'NVDAc', capital: 21, days: 63, entryAPY: 0.45, exitAPY: 0.45, baseAPY: 1552741.82 }}
        set={noop}
        markets={[nvda]}
        onPick={noop}
        loadingMarket={false}
      />,
    );
    expect(html).toContain('غیرعادی');
    expect(html).toContain('نقدینگی کل این بازار');
    expect(html).toContain('در رتبه‌بندی و فهرست فرصت‌ها نیست');
    expect(html).toContain('از API نیامده');
    // No green «points are free» conclusion from garbage inputs.
    expect(html).toContain('قابل اتکا نیستند');
    expect(html).not.toContain('رایگان‌اند');
  });
});
