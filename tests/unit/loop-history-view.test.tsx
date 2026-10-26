import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LoopHistoryRow } from '../../src/lib/pendleloop/types';

// Controlled test data; not market data.

const BOX = `0x${'b1'.repeat(32)}`;
const PT = `0x${'ab'.repeat(20)}`;
/** 30 days of hours: PT at 0.97, the oracle 5% under it (a fixed-curve oracle), borrow 8%. */
const rows: LoopHistoryRow[] = Array.from({ length: 24 * 30 }, (_, i) => [1_790_000_000 + i * 3600, 8, 0.97 * 0.95, 0.97, 12, 1e6]);

vi.mock('../../src/hooks/useLoopHistory', () => ({
  useLoopHistory: () => ({ feed: { chainId: 1, pt: PT, fetchedAt: '', series: [{ boxId: BOX, moneyMarketAddress: '', debtAsset: '', rows }] }, loading: false, failed: false }),
}));

describe('loop history view', () => {
  it('table: every leverage, the chosen one in words, «cannot open» where the oracle leaves no room', async () => {
    const { LoopHistory } = await import('../../src/components/market/LoopHistory');
    const html = renderToStaticMarkup(<LoopHistory chainId={1} collateral={PT} boxId={BOX} lltv={0.915} leverage={4} top={8.8} />);
    expect(html).toContain('اگر قبلاً وارد این لوپ می‌شدید');
    expect(html).toContain('هیچ ورودی لیکوئید نمی‌شد');
    expect(html).toContain('باز نمی‌شود');
    expect((html.match(/<tr /g) ?? []).length).toBe(7); // 2, 3, 4, 5, 6, 8.8
  });

  it('line: the leverage in use and 6× above it; nothing for a box it cannot find', async () => {
    const { LoopHistory, LoopHistoryFor } = await import('../../src/components/market/LoopHistory');
    const line = renderToStaticMarkup(<LoopHistory chainId={1} collateral={PT} boxId={BOX} lltv={0.915} leverage={3} variant="line" />);
    expect(line).toContain('روز گذشته');
    // 3× (in use), then 4× and 6× above it; 6× opens here with a thin buffer, so it is a warning.
    expect(line).toContain('۴×');
    expect(line).toContain('<span class="text-warning">؛ با <bdi dir="ltr" class="num ">۶×</bdi>');
    const none = renderToStaticMarkup(<LoopHistoryFor o={{ chain: 'eip155:1', loop: null }} leverage={3} />);
    expect(none).toBe('');
  });
});
