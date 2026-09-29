import { describe, expect, it } from 'vitest';
import type { Fee, Position, PositionEvent } from '../../src/types/position';
import { emptyManual, emptyTargets } from '../../src/types/position';
import { buildLedger } from '../../src/lib/portfolio/ledger';
import { valuePosition, type MarketQuote } from '../../src/lib/portfolio/valuation';
import { analyzePosition, compareMarkets, positionAlerts } from '../../src/lib/portfolio/analysis';
import { allocation, appendSnapshot, mergeBackup, parseBackup, portfolioTotals } from '../../src/lib/portfolio/portfolio';
import { ptPriceFromAPY } from '../../src/lib/calculators/implied-apy';
import type { OpportunityListing } from '../../src/lib/risk/opportunities';
import { maturedSummary } from '../../src/lib/portfolio/matured';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 0, 1);
const iso = (days: number) => new Date(T0 + days * DAY).toISOString();

let n = 0;
const ev = (type: PositionEvent['type'], day: number, units: number, amount: number, over: Partial<PositionEvent> = {}): PositionEvent => ({
  id: `e${n++}`,
  type,
  at: iso(day),
  units,
  cash: { amount, token: 'USDC', usdRate: 1, rateSource: 'manual' },
  assetUsd: 1,
  assetUsdSource: 'manual',
  fees: [],
  note: '',
  ...over,
});

const fee = (amount: number, included: boolean, kind: Fee['kind'] = 'network'): Fee => ({
  amount,
  token: 'USDC',
  usdRate: 1,
  rateSource: 'manual',
  kind,
  included,
});

const pos = (over: Partial<Position>): Position => ({
  id: 'p1',
  createdAt: iso(0),
  updatedAt: iso(0),
  kind: 'pt',
  protocol: 'pendle',
  chain: 'Ethereum',
  marketId: '1-0xabc',
  marketName: 'sUSDe',
  platform: 'Ethena',
  icon: '',
  maturity: iso(365),
  assetSymbol: 'USDe',
  events: [],
  loop: null,
  manual: emptyManual(),
  targets: emptyTargets(),
  points: { perDay: 0, multiplier: 1, basis: 'unit', valuePerPoint: 0 },
  snapshots: [],
  note: '',
  ...over,
});

const quote = (over: Partial<MarketQuote> = {}, now = T0): MarketQuote => ({
  ptPrice: 0.95,
  ytPrice: 0.05,
  assetUsd: 1,
  impliedAPY: 8,
  baseAPY: 10,
  liquidity: 10_000_000,
  fetchedAt: new Date(now).toISOString(),
  history: null,
  ...over,
});

describe('ledger: fees', () => {
  it('adds separate fees to the cost basis but never subtracts included fees twice', () => {
    const separate = buildLedger({ events: [ev('buy', 0, 1000, 900, { fees: [fee(5, false)] })], loop: null });
    expect(separate.costUsd).toBe(905);
    expect(separate.fees.total).toBe(5);

    const included = buildLedger({ events: [ev('buy', 0, 1000, 900, { fees: [fee(5, true, 'trade')] })], loop: null });
    expect(included.costUsd).toBe(900);
    expect(included.fees.trade).toBe(5);
    expect(included.fees.separate).toBe(0);
  });

  it('nets separate fees out of sale proceeds', () => {
    const L = buildLedger({ events: [ev('buy', 0, 100, 90), ev('sell', 10, 100, 95, { fees: [fee(1, false)] })], loop: null });
    expect(L.realizedUsd).toBeCloseTo(4, 10);
    expect(L.withdrawalsUsd).toBe(94);
  });
});

describe('ledger: partial exits', () => {
  it('removes average cost pro rata and keeps the rest as basis', () => {
    const L = buildLedger({
      events: [ev('buy', 0, 100, 90), ev('buy', 5, 100, 94), ev('sell', 10, 50, 48)],
      loop: null,
    });
    // Average cost 0.92/unit; 50 units remove 46.
    expect(L.units).toBe(150);
    expect(L.costUsd).toBeCloseTo(138, 10);
    expect(L.realizedUsd).toBeCloseTo(2, 10);
  });

  it('does not sell more than is held', () => {
    const L = buildLedger({ events: [ev('buy', 0, 10, 9), ev('sell', 1, 50, 10)], loop: null });
    expect(L.units).toBe(0);
    expect(L.costUsd).toBeCloseTo(0, 10);
  });
});

describe('valuation', () => {
  it('a new deposit is not profit', () => {
    const q = quote({ ptPrice: 0.9 });
    const one = valuePosition(pos({ events: [ev('buy', 0, 1000, 900)] }), q, T0);
    const two = valuePosition(pos({ events: [ev('buy', 0, 1000, 900), ev('buy', 0, 1000, 900)] }), q, T0);
    expect(one.pnlUsd).toBeCloseTo(0, 8);
    expect(two.pnlUsd).toBeCloseTo(0, 8);
    expect(two.investedUsd).toBe(1800);
  });

  it('separates the asset price move from the asset-denominated return', () => {
    // Bought 1000 PT for 0.9 ETH-equivalent at $2000; now PT 0.95 and ETH $2500.
    const events = [ev('buy', 0, 1000, 1_800_000, { assetUsd: 2000 })];
    const v = valuePosition(pos({ events, assetSymbol: 'ETH' }), quote({ ptPrice: 0.95, assetUsd: 2500 }), T0);
    expect(v.markValueUsd).toBeCloseTo(2_375_000, 4);
    expect(v.pnlUsd).toBeCloseTo(575_000, 4);
    // In ETH: 950 now − 900 paid = 50 ETH.
    expect(v.pnlAsset).toBeCloseTo(50, 8);
    expect(v.pnlAssetPct).toBeCloseTo((50 / 900) * 100, 8);
    // 50 ETH × $2500 = 125k explained by yield; the rest by the ETH price.
    expect(v.assetPriceEffectUsd).toBeCloseTo(450_000, 4);
  });

  it('locks the entry APY from the price actually paid', () => {
    const paid = ptPriceFromAPY(8, 365);
    const v = valuePosition(pos({ events: [ev('buy', 0, 1000, 1000 * paid)] }), quote(), T0);
    expect(v.entryAPY).toBeCloseTo(8, 6);
  });

  it('values PT at 1 asset after maturity and keeps it open until redemption is recorded', () => {
    const p = pos({ maturity: iso(30), events: [ev('buy', 0, 1000, 990)] });
    const v = valuePosition(p, quote({ ptPrice: 0.7 }, T0 + 40 * DAY), T0 + 40 * DAY);
    expect(v.status).toBe('matured');
    expect(v.tokenPrice).toEqual({ value: 1, quality: 'rule' });
    expect(v.exit.costPct).toBe(0);
    expect(v.pnlUsd).toBeCloseTo(10, 8);

    const redeemed = valuePosition({ ...p, events: [...p.events, ev('redeem', 41, 1000, 1000)] }, null, T0 + 42 * DAY);
    expect(redeemed.status).toBe('closed');
    expect(redeemed.realizedUsd).toBeCloseTo(10, 8);
  });

  it('labels stale and missing data instead of treating it as live', () => {
    const p = pos({ events: [ev('buy', 0, 1000, 900)] });
    expect(valuePosition(p, quote({}, T0), T0 + 60 * 60_000).tokenPrice.quality).toBe('stale');
    const none = valuePosition(p, null, T0);
    expect(none.tokenPrice.quality).toBe('missing');
    expect(none.pnlUsd).toBeNaN();
    const manual = valuePosition({ ...p, manual: { ...emptyManual(), tokenPrice: { value: 0.93, at: iso(0) }, assetUsd: { value: 1, at: iso(0) } } }, null, T0);
    expect(manual.tokenPrice.quality).toBe('manual');
    expect(manual.pnlUsd).toBeCloseTo(30, 8);
  });

  it('charges swap fee and price impact on the exit estimate', () => {
    const v = valuePosition(pos({ events: [ev('buy', 0, 100_000, 90_000)] }), quote({ ptPrice: 0.95, liquidity: 1_000_000 }), T0, { feePct: 0.5, networkUsd: 2 });
    // 95k is 9.5% of liquidity → impact 4.75%.
    expect(v.exit.impactPct).toBeCloseTo(4.75, 8);
    expect(v.exit.proceedsUsd).toBeCloseTo(95_000 * (1 - 0.0525) - 2, 6);
    expect(v.exit.quality).toBe('estimate');
  });
});

describe('YT yield', () => {
  it('uses daily history when it covers the holding period', () => {
    const p = pos({ kind: 'yt', events: [ev('buy', 0, 1000, 50)] });
    const now = T0 + 10 * DAY;
    const v = valuePosition(p, quote({ history: Array(30).fill(10) }, now), now);
    expect(v.unclaimedYield.quality).toBe('historical');
    // Accrued yield is paid out, not reinvested: simple sum of daily yield.
    expect(v.unclaimedYield.value).toBeCloseTo(10 * 1000 * (1.1 ** (1 / 365) - 1), 6);
  });

  it('falls back to the current rate only as an estimate', () => {
    const p = pos({ kind: 'yt', events: [ev('buy', 0, 1000, 50)] });
    const now = T0 + 10 * DAY;
    const v = valuePosition(p, quote({ history: null }, now), now);
    expect(v.unclaimedYield.quality).toBe('estimate');
  });

  it('restarts accrual after a recorded claim and never counts points as profit', () => {
    const p = pos({
      kind: 'yt',
      events: [ev('buy', 0, 1000, 50), ev('claim_yield', 5, 0, 1)],
      points: { perDay: 1, multiplier: 5, basis: 'unit', valuePerPoint: 100 },
    });
    const now = T0 + 10 * DAY;
    const v = valuePosition(p, quote({ history: Array(30).fill(10), ytPrice: 0.05 }, now), now);
    expect(v.unclaimedYield.value).toBeCloseTo(5 * 1000 * (1.1 ** (1 / 365) - 1), 6);
    expect(v.ledger.incomeYieldUsd).toBe(1);
    expect(v.points).toBeCloseTo(1000 * 5 * 10, 6);
    // P&L = 50 + unclaimed + 1 − 50: no airdrop value.
    expect(v.pnlUsd).toBeCloseTo(v.unclaimedYield.value + 1, 6);
  });
});

describe('PT loop', () => {
  const loopPos = (over: Partial<Position> = {}) =>
    pos({
      kind: 'loop',
      events: [ev('borrow', 0, 0, 2000), ev('buy', 0, 3000 / 0.95, 3000)],
      loop: {
        lendingPlatform: 'Morpho',
        lendingMarket: 'PT-sUSDe/USDC',
        debtAsset: 'USDC',
        debtIsAccountingAsset: true,
        debtAssetUsd: null,
        borrowAPY: 10,
        lltv: 86,
        oracle: 'market',
        oraclePtPrice: null,
        debtOverride: null,
      },
      ...over,
    });

  it('accrues debt interest and treats own capital as invested', () => {
    const now = T0 + 73 * DAY;
    const L = buildLedger(loopPos(), now);
    expect(L.debtUnits).toBeCloseTo(2000 * 1.1 ** (73 / 365), 8);
    const v = valuePosition(loopPos(), quote({ ptPrice: 0.95 }, now), now);
    expect(v.investedUsd).toBeCloseTo(1000, 8);
    // Equity (collateral − debt) minus own capital.
    expect(v.pnlUsd).toBeCloseTo(3000 - L.debtUnits - 1000, 6);
  });

  it('computes health factor and liquidation price from the oracle', () => {
    const v = valuePosition(loopPos(), quote({ ptPrice: 0.95 }), T0);
    const units = 3000 / 0.95;
    expect(v.loop!.healthFactor).toBeCloseTo((3000 * 0.86) / 2000, 8);
    expect(v.loop!.liquidationPtPrice).toBeCloseTo(2000 / (units * 0.86), 8);
    expect(v.loop!.leverage).toBeCloseTo(3, 8);
    const manualOracle = valuePosition(loopPos({ loop: { ...loopPos().loop!, oracle: 'manual', oraclePtPrice: 0.97 } }), quote({ ptPrice: 0.95 }), T0);
    expect(manualOracle.loop!.healthFactor).toBeCloseTo((units * 0.97 * 0.86) / 2000, 8);
    expect(manualOracle.loop!.quality).toBe('manual');
  });

  it('realises interest paid on repayment', () => {
    const p = loopPos();
    const repayDay = 73;
    const debt = 2000 * 1.1 ** (repayDay / 365);
    const L = buildLedger({ ...p, events: [...p.events, ev('repay', repayDay, 0, debt)] }, T0 + repayDay * DAY);
    expect(L.debtUnits).toBe(0);
    expect(L.interestPaidUsd).toBeCloseTo(debt - 2000, 6);
    expect(L.realizedUsd).toBeCloseTo(-(debt - 2000), 6);
  });

  it('warns below the minimum health', () => {
    const p = loopPos({ targets: { ...emptyTargets(), minHealth: 1.5 } });
    const v = valuePosition(p, quote({ ptPrice: 0.95 }), T0);
    expect(positionAlerts(p, v).some((a) => a.level === 'warning' && a.text.includes('سلامت'))).toBe(true);
  });
});

describe('analysis', () => {
  it('PT: hold vs exit reports the remaining yield and scenarios', () => {
    const p = pos({ events: [ev('buy', 0, 1000, 900)] });
    const a = analyzePosition(p, valuePosition(p, quote(), T0), quote());
    expect(a.scenarios.length).toBeGreaterThanOrEqual(3);
    expect(a.summary.join(' ')).toContain('بازده سالانه');
    expect(a.lean).toBe('hold');
  });

  it('YT: without history the range is labelled as an estimate', () => {
    const p = pos({ kind: 'yt', events: [ev('buy', 0, 1000, 50)] });
    const a = analyzePosition(p, valuePosition(p, quote(), T0), quote());
    expect(a.assumptions.join(' ')).toContain('تخمینی');
  });

  it('switching compares on the same horizon and ignores tiny advantages', () => {
    const p = pos({ events: [ev('buy', 0, 10_000, 9_000)] });
    const v = valuePosition(p, quote({ ptPrice: ptPriceFromAPY(8, 365), liquidity: 50_000_000 }), T0);
    const row = (id: string, apy: number, chain = 'Ethereum'): OpportunityListing => ({
      protocol: 'pendle', id, name: 'sUSDe', platform: '', icon: null, chain, maturity: iso(365), impliedAPY: apy, baseAPY: 5,
      liquidity: 50_000_000, hasPoints: false, ytMultiplier: null, points: null, categories: ['stables'], isNew: false, expired: false, daysToMaturity: 365,
    });
    const current = { ...row(p.marketId, 8) };
    const res = compareMarkets(p, v, [row('same', 8.05), row('better', 14), row('other-chain', 14, 'Base')], current);
    const better = res.find((r) => r.m.id === 'better')!;
    const same = res.find((r) => r.m.id === 'same')!;
    expect(better.meaningful).toBe(true);
    expect(same.meaningful).toBe(false);
    expect(res.find((r) => r.m.id === 'other-chain')!.risks.join()).toContain('شبکه');
    expect(better.advantageUsd).toBeGreaterThan(res.find((r) => r.m.id === 'other-chain')!.advantageUsd);
  });
});

describe('portfolio', () => {
  it('totals and allocation skip unpriced positions', () => {
    const a = pos({ id: 'a', events: [ev('buy', 0, 1000, 900)] });
    const b = pos({ id: 'b', chain: 'Base', events: [ev('buy', 0, 1000, 900)] });
    const items = [
      { p: a, v: valuePosition(a, quote(), T0) },
      { p: b, v: valuePosition(b, null, T0) },
    ];
    const t = portfolioTotals(items);
    expect(t.unpriced).toBe(1);
    expect(t.netValueUsd).toBeCloseTo(950, 8);
    expect(t.pnlPct).toBeCloseTo((50 / 900) * 100, 8);
    expect(allocation(items, (x) => x.p.chain)).toEqual([{ key: 'Ethereum', valueUsd: 950, share: 100 }]);
  });

  it('snapshots are rate-limited and never backfilled', () => {
    const s1 = appendSnapshot([], { at: iso(0), valueUsd: 1, pnlUsd: 0 });
    const s2 = appendSnapshot(s1, { at: new Date(T0 + 10 * 60_000).toISOString(), valueUsd: 2, pnlUsd: 0 });
    const s3 = appendSnapshot(s2, { at: iso(5), valueUsd: 3, pnlUsd: 0 });
    expect(s2).toHaveLength(1);
    expect(s3.map((s) => s.valueUsd)).toEqual([1, 3]);
  });

  it('backups round-trip and reject malformed files', () => {
    const p = pos({ events: [ev('buy', 0, 1, 1)] });
    const file = parseBackup(JSON.stringify({ version: 1, exportedAt: iso(0), positions: [p], history: [] }));
    expect(file?.positions[0].id).toBe('p1');
    expect(parseBackup('{"version":1,"positions":[{"id":1}]}')).toBeNull();
    expect(parseBackup('nope')).toBeNull();
    expect(mergeBackup([pos({ id: 'x' }), p], file!)).toHaveLength(2);
  });
});

describe('matured positions summary', () => {
  const past = { maturity: iso(30) };
  const after = T0 + 40 * DAY;

  it('uses the recorded redemption: exit date, received amount, P&L', () => {
    const p = pos({ ...past, events: [ev('buy', 0, 1000, 950), ev('redeem', 32, 1000, 1000, { cash: { amount: 1000, token: 'USDe', usdRate: 1, rateSource: 'manual' } })] });
    const m = maturedSummary(p, valuePosition(p, quote({}, after), after));
    expect(m.enteredAt).toBe(iso(0));
    expect(m.exitedAt).toBe(iso(32));
    expect(m.paid).toEqual([{ token: 'USDC', amount: 950, usd: 950 }]);
    expect(m.received).toEqual([{ token: 'USDe', amount: 1000, usd: 1000 }]);
    expect(m.estimated).toBe(false);
    expect(m.pnlUsd).toBeCloseTo(50, 6);
  });

  it('labels the output as an estimate when no exit is recorded (PT → 1 asset unit each)', () => {
    const p = pos({ ...past, events: [ev('buy', 0, 1000, 950)] });
    const m = maturedSummary(p, valuePosition(p, quote({}, after), after));
    expect(m.exitedAt).toBeNull();
    expect(m.received).toEqual([]);
    expect(m.estimated).toBe(true);
    expect(m.estimateUnits).toBe(1000);
  });

  it('YT at maturity is worth 0 units', () => {
    const p = pos({ ...past, kind: 'yt', events: [ev('buy', 0, 1000, 40)] });
    expect(maturedSummary(p, valuePosition(p, quote({}, after), after)).estimateUnits).toBe(0);
  });
});
