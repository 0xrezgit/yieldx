import { describe, expect, it } from 'vitest';
import loops from '../fixtures/loopscale-loops.json';
import { loopscaleLoop, type LoopscaleLoopInfo } from '../../src/lib/lending/loopscale';
import { buildLoops, defaultLeverageInput } from '../../src/lib/opportunity/leverage';
import { estimate } from '../../src/lib/opportunity/estimate';

// Loopscale's /v1/markets/loop/info, 2026-11-08 (five of its 103 loops).
const AT = '2026-11-08T00:00:00.000Z';
const NOW = Date.parse(AT);
const row = (slug: keyof typeof loops) => loopscaleLoop(slug, loops[slug] as LoopscaleLoopInfo, AT);

describe('Loopscale loops as borrow sides', () => {
  it('reads the borrow rate back from the net APY at the highest leverage (L·y − (L−1)·b)', () => {
    const o = row('onyc-usdc')!;
    // 4 × 11.02 − 3 × b = 17.08 → b = 9.00 %.
    expect(o.borrow!.ratePct).toBeCloseTo((4 * 11.02 - 17.08) / 3, 9);
    // 6,283.86 USDC offered, at USDC's dollar price as the API values it.
    expect(Math.abs(o.borrow!.availableUsd! - 6283.86) / 6283.86).toBeLessThan(0.001);
    expect(o.family).toBe('borrow');
  });

  it('with no offer today, from the borrowers’ own leverage and APY — and nothing to borrow', () => {
    const o = row('ehyusd-usdc')!;
    const l = loops['ehyusd-usdc'];
    expect(o.borrow!.ratePct).toBeCloseTo((l.wAvgLeverage! * l.collateralApyPct - l.wAvgApy!) / (l.wAvgLeverage! - 1), 9);
    expect(o.borrow!.availableUsd).toBe(0);
  });

  it('a closed loop (max leverage 0) is left out; a PT carries no yield of its own here', () => {
    expect(row('onyc-usdt')).toBeNull();
    expect(row('onyc-10jan27-usdc')!.borrow!.collateral[0].yield).toBeNull();
  });

  it('the liquidation LTV stands at the borrow limit: liquidation is never shown further than it is', () => {
    expect(row('onyc-usdc')!.borrow!.collateral[0].maxLtv).toBeCloseTo(1 - 1 / 4, 9);
  });

  it('becomes a loop like any other: ONyc as an RWA at the cautious leverage, eHYUSD set aside without capacity', () => {
    const built = buildLoops([row('onyc-usdc')!, row('ehyusd-usdc')!, row('prime-usdc')!]);
    const onyc = built.find((l) => l.loop!.collateral.token.symbol === 'ONyc')!;
    expect(onyc.loop!.rwa?.issuer).toBe('OnRe');
    const e = estimate(onyc, { capital: 1000, days: 30, now: NOW, leverage: defaultLeverageInput });
    expect(e.placement).toBe('ranked');
    expect(e.leverage!.leverage).toBeLessThanOrEqual(2.5);
    const ehy = built.find((l) => l.loop!.collateral.token.symbol === 'eHYUSD')!;
    expect(estimate(ehy, { capital: 1000, days: 30, now: NOW, leverage: defaultLeverageInput }).placement).toBe('no-capacity');
  });
});
