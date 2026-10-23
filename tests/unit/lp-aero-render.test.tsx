import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { LpAnalyzer } from '../../src/components/opportunities/LpAnalyzer';
import type { LpPrefill } from '../../src/components/opportunities/LpAnalyzer';
import type { PoolReward } from '../../src/lib/lp/rewards';
import { assertPersianMoney } from '../helpers/text';

// Controlled values shaped like the recorded Aero EURC/USDC pool (lp-aero.test.ts).

const reward: PoolReward = { token: 'AERO', weeklyUsd: 3118.64, aprPct: 0.0296, stakedFullRangeUsd: 548e6, revenueWeeklyUsd: 1062, revenueDays: 1, url: 'https://vfat.io/farm?farmId=stake' };
const prefill = (over: Partial<LpPrefill> = {}): LpPrefill => ({
  name: 'EURC/USDC · Aero',
  a: 'EURC',
  b: 'USDC',
  chain: 'Base',
  chainId: 8453,
  protocol: 'Aero',
  source: 'vfat',
  concentrated: true,
  move7d: { down: 1.52, up: 0.73 },
  vol: 6.09,
  feeApr: null,
  unstakedFee: 0.05,
  reward,
  mode: 'stake',
  url: 'https://vfat.io/farm?farmId=lp',
  venueUrl: 'https://app.aero.xyz/pools/8453-0x6eaec4f69c92bd16a4b018ceb6fe7a446a113598',
  capital: 1000,
  days: 30,
  ...over,
});

const visible = (html: string) => html.replace(/title="[^"]*"/g, '').replace(/href="[^"]*"/g, '').replace(/aria-label="[^"]*"/g, '').replace(/<bdi dir="ltr"[^>]*>[^<]*<\/bdi>/g, '');

describe('LP analyzer: an Aero pool', () => {
  it('staked: the AERO rate, the cap warning, range odds, the narrow-to-wide table and what to know', () => {
    const html = renderToString(<LpAnalyzer prefill={prefill()} />);
    for (const t of ['stake: پاداش', 'برابر درآمد کارمزد آن است', 'احتمال ماندن قیمت در این بازه', 'بازه‌ی باریک‌تر: نرخ بیشتر روی کاغذ، خروج زودتر', 'پیش از ورود بدانید', 'حداقل دوره‌ی stake', 'صفحه‌ی استخر در', 'ورود و stake']) expect(html).toContain(t);
    expect(html).toContain('https://vfat.io/farm?farmId=stake');
    expect(html).not.toContain('NaN');
    assertPersianMoney(visible(html));
  });

  it('unstaked without a fee history: says so, and names the 5% platform share', () => {
    const html = renderToString(<LpAnalyzer prefill={prefill({ mode: 'fees', feeApr: 2 })} />);
    // Numbers carry invisible direction marks.
    expect(html.replace(/<[^>]+>/g, '')).toMatch(/منهای سهم \p{Cf}*۵٪\p{Cf}* پلتفرم/u);
    expect(html).toContain('ولی AERO نمی‌گیرید');
    const none = renderToString(<LpAnalyzer prefill={prefill({ reward: null, mode: 'fees' })} />);
    expect(none).toContain('هنوز دو هفته تاریخچه‌ی کارمزد ندارد');
  });

  it('an old Aerodrome gauge and a sunset chain are called out', () => {
    const html = renderToString(<LpAnalyzer prefill={prefill({ reward: null, venueUrl: undefined, legacyGauge: true, feeApr: 3, chainId: 1135 })} />);
    expect(html).toContain('نه پاداش می‌گیرد نه کارمزد');
    expect(html).toContain('باید تا');
    assertPersianMoney(visible(html));
  });
});
