import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { renderToStaticMarkup } from 'react-dom/server';
import boxes from '../fixtures/pendle-longshort.json';
import { longShortRow } from '../../src/lib/longshort/feed';
import { analyzeLongShort } from '../../src/lib/longshort/model';
import { MarketPicker, Outcomes, PerpCompare, Review, Summary } from '../../src/components/tools/LongShortTool';

type Box = Parameters<typeof longShortRow>[0];
const perp = { venue: 'Hyperliquid' as const, coin: 'ETH', fundingNowPct: 10.9, funding7dPct: 7.8, maxLeverage: 25, markPx: 2400, url: 'https://app.hyperliquid.xyz/trade/ETH' };
const rows = (boxes as unknown as Box[]).map((b) => ({ ...longShortRow(b)!, perp }));
const s = { key: null, side: 'long' as const, category: 'all' as const, capital: 1000, leverage: 3, days: 30, swapPct: 0.1, perpFeePct: 0.045 };

describe('Long/Short tool sections', () => {
  it.each(rows.map((r) => [r.base.symbol + ' ' + r.side, r] as const))('renders %s', (_, row) => {
    const a = analyzeLongShort(row, s);
    const html = [<MarketPicker key="p" rows={rows} value={row.key} onChange={() => {}} />, <Summary key="s" row={row} a={a} s={s} />, <Review key="r" row={row} a={a} s={s} />, <Outcomes key="o" row={row} a={a} />, <PerpCompare key="c" row={row} a={a} s={s} />]
      .map((el) => renderToStaticMarkup(el))
      .join('');
    expect(html).toContain('قیمت لیکوییدشدن');
    expect(html).toContain('بررسی این بازار');
    expect(html).toContain('Hyperliquid');
    expect(html).not.toContain('NaN');
  });
});
