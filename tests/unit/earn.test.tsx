import { describe, expect, it } from 'vitest';
import type { EarnEvent, EarnPosition } from '../../src/types/earn';
import type { Estimate, Opportunity } from '../../src/types/opportunity';
import { earnFromOpportunity, normalizeEarn, switchAdvice, valueEarn } from '../../src/lib/portfolio/earn';
import { parseBackup } from '../../src/lib/portfolio/portfolio';
import { buildLoops } from '../../src/lib/opportunity/leverage';

// Controlled test data; not market data.

const T0 = Date.parse('2026-09-01T00:00:00Z');
const day = 86_400_000;
const at = (d: number) => new Date(T0 + d * day).toISOString();
const ev = (type: EarnEvent['type'], d: number, amount: number, token = 'USDC', usdRate: number | null = 1): EarnEvent => ({ id: `${type}-${d}-${amount}`, type, at: at(d), cash: { amount, token, usdRate, rateSource: usdRate === null ? 'unknown' : 'manual' }, fees: [], note: '' });

const pos = (over: Partial<EarnPosition> = {}): EarnPosition => ({
  id: 'p1',
  createdAt: at(0),
  updatedAt: at(0),
  family: 'lend',
  protocol: { id: 'morpho', name: 'Morpho', version: 'blue' },
  chain: 'eip155:1',
  market: { id: 'm', name: 'USDC · وثیقه WBTC', address: null },
  opportunityKey: null,
  asset: { symbol: 'USDC', address: null },
  debtAsset: null,
  maturity: null,
  manualRate: 5,
  manualBorrowRate: null,
  maxLtv: null,
  balance: null,
  debt: null,
  assetUsd: null,
  debtUsd: null,
  exitCostUsd: null,
  events: [ev('deposit', 0, 1000)],
  note: '',
  ...over,
});
const none = { rate: null, borrowRate: null, assetUsd: null, debtUsd: null };
const NOW = T0 + 30 * day;

describe('valuation', () => {
  it('without a reading: principal accrued at the rate, labelled an estimate and incomplete', () => {
    const v = valueEarn(pos(), none, NOW);
    expect(v.balanceUnits).toBeCloseTo(1000 * Math.pow(1.05, 30 / 365), 9);
    expect(v.balanceQuality).toBe('estimate');
    expect(v.incomplete).toBe(true);
    expect(v.pnlUsd).toBeCloseTo(v.balanceUnits - 1000, 9);
    // A dollar stablecoin is priced at its peg by rule, and says so.
    expect(v.assetUsd.quality).toBe('rule');
  });

  it('with a fresh reading from the protocol: exact and complete', () => {
    const v = valueEarn(pos({ balance: { amount: 1012, at: new Date(NOW).toISOString() } }), none, NOW);
    expect(v.balanceUnits).toBeCloseTo(1012, 9);
    expect(v.balanceQuality).toBe('manual');
    expect(v.pnlUsd).toBeCloseTo(12, 9);
    expect(v.incomplete).toBe(false);
  });

  it('an event without a USD rate makes the total incomplete, never zero', () => {
    const v = valueEarn(pos({ asset: { symbol: 'wstETH', address: null }, assetUsd: 3000, events: [ev('deposit', 0, 1, 'wstETH', null)] }), none, NOW);
    expect(v.missingRates).toBe(1);
    expect(v.incomplete).toBe(true);
    expect(v.reasons.join(' ')).toContain('نرخ دلاری ندارد');
    expect(v.valueUsd).toBeGreaterThan(0);
  });

  it('a loop counts own money plus profit, never the gross collateral', () => {
    const p = pos({
      family: 'leverage',
      asset: { symbol: 'sUSDe', address: null },
      debtAsset: { symbol: 'USDC', address: null },
      manualRate: 8,
      manualBorrowRate: 5,
      maxLtv: 0.86,
      events: [ev('deposit', 0, 3000, 'sUSDe', 1), ev('borrow', 0, 2000, 'USDC', 1)],
    });
    const v = valueEarn(p, none, NOW);
    expect(v.valueUsd).toBeCloseTo(3000 * Math.pow(1.08, 30 / 365), 6);
    expect(v.debtUsd).toBeCloseTo(2000 * Math.pow(1.05, 30 / 365), 6);
    expect(v.netValueUsd).toBeCloseTo(1011, 0);
    expect(v.pnlUsd).toBeCloseTo(v.netValueUsd - 1000, 9);
    expect(v.health!.ltv).toBeCloseTo(v.debtUsd / v.valueUsd, 12);
  });

  it('separates realised and unrealised, and closes when everything is out', () => {
    const p = pos({ events: [ev('deposit', 0, 1000), ev('withdraw', 10, 500), ev('claim_reward', 12, 3)] });
    const v = valueEarn(p, none, NOW);
    expect(v.realizedUsd).toBeCloseTo(3, 9);
    expect(v.withdrawalsUsd).toBeCloseTo(503, 9);
    expect(v.realizedUsd + v.unrealizedUsd).toBeCloseTo(v.pnlUsd, 9);
    const closed = valueEarn(pos({ balance: { amount: 0, at: new Date(NOW).toISOString() }, events: [ev('deposit', 0, 1000), ev('withdraw', 30, 1004)] }), none, NOW);
    expect(closed.status).toBe('closed');
    expect(closed.pnlUsd).toBeCloseTo(4, 9);
  });

  it('never subtracts a fee already inside the amounts', () => {
    const e = ev('deposit', 0, 1000);
    const inside = valueEarn(pos({ events: [{ ...e, fees: [{ amount: 5, token: 'USD', usdRate: 1, rateSource: 'manual', kind: 'network', included: true }] }] }), none, NOW);
    const outside = valueEarn(pos({ events: [{ ...e, fees: [{ amount: 5, token: 'USD', usdRate: 1, rateSource: 'manual', kind: 'network', included: false }] }] }), none, NOW);
    expect(inside.contributionsUsd).toBeCloseTo(1000, 9);
    expect(outside.contributionsUsd).toBeCloseTo(1005, 9);
  });
});

describe('continue or exit (report §7-3)', () => {
  const alt = (net: number, family: Opportunity['family'] = 'vault'): { e: Estimate; o: Opportunity } => ({
    e: { net, placement: 'ranked', costs: [{ key: 'gas-entry', label: '', usd: 3, basis: 'assumed' }] } as unknown as Estimate,
    o: { key: `alt-${net}-${family}`, family, protocol: { name: 'X' }, market: { name: 'Y' } } as unknown as Opportunity,
  });
  const p = pos({ manualRate: 3, balance: { amount: 10_000, at: new Date(NOW).toISOString() }, exitCostUsd: 5 });
  const v = valueEarn(p, none, NOW);

  it('suggests a switch only when it repays exit and entry within the period', () => {
    const a = switchAdvice(p, v, [alt(50)], 30);
    expect(a.continueUsd!).toBeCloseTo(10_000 * (Math.pow(1.03, 30 / 365) - 1), 9);
    expect(a.advantageUsd!).toBeCloseTo(50 - a.continueUsd! - 5, 9);
    expect(a.breakEvenDays!).toBeLessThan(30);
    expect(a.verdict).toBe('switch');
  });

  it('a small edge is no reason to move', () => {
    expect(switchAdvice(p, v, [alt(30)], 30).verdict).toBe('stay');
  });

  it('a riskier family is never suggested on its own', () => {
    const a = switchAdvice(p, v, [alt(500, 'leverage')], 30);
    expect(a.verdict).toBe('stay');
    expect(a.why.join(' ')).toContain('پرریسک‌تر');
  });

  it('without an exit cost it does not decide', () => {
    const q = { ...p, exitCostUsd: null };
    expect(switchAdvice(q, valueEarn(q, none, NOW), [alt(50)], 30).verdict).toBe('unknown');
  });
});

describe('storage and links', () => {
  it('reads version 2 backups with earn positions and still reads version 1', () => {
    const v2 = parseBackup(JSON.stringify({ version: 2, exportedAt: '', positions: [], history: [], earn: [pos()] }));
    expect(v2!.earn).toHaveLength(1);
    const v1 = parseBackup(JSON.stringify({ version: 1, exportedAt: '', positions: [], history: [] }));
    expect(v1!.earn).toEqual([]);
    expect(parseBackup(JSON.stringify({ version: 2, positions: [], earn: [{ id: 'x', family: 'nope' }] }))).toBeNull();
  });

  it('fills fields added later and rejects broken records', () => {
    const { note, balance, ...old } = pos();
    void note;
    void balance;
    const n = normalizeEarn(old)!;
    expect(n.note).toBe('');
    expect(n.balance).toBeNull();
    expect(normalizeEarn({ ...pos(), events: [{ id: 'e', type: 'buy' }] })).toBeNull();
  });

  it('carries a ranking row into the portfolio with its rate link', () => {
    const market: Opportunity = {
      key: 'morpho:eip155:1:0xm:supply',
      family: 'lend',
      protocol: { id: 'morpho', version: 'blue', name: 'Morpho' },
      chain: 'eip155:1',
      market: { id: '0xm', address: null, name: 'USDC' },
      assets: { deposit: [{ symbol: 'USDC', address: '0xusdc' }] },
      rate: { value: 4, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: null },
      maturity: null,
      capacity: { depositRemainingUsd: null, withdrawableNowUsd: null },
      exit: { type: 'instant' },
      rewards: [],
      borrow: { ratePct: 5, curve: null, availableUsd: 1e9, collateral: [{ token: { symbol: 'sUSDe', address: '0xs' }, maxLtv: 0.86, yield: { pct: 8, kind: 'apy', source: 't' } }], metric: 'ltv' },
      quality: 'current',
      sources: [],
    };
    expect(earnFromOpportunity(market, 'a')).toMatchObject({ family: 'lend', opportunityKey: market.key, asset: { symbol: 'USDC' } });
    const loop = earnFromOpportunity(buildLoops([market])[0], 'b')!;
    expect(loop).toMatchObject({ family: 'leverage', asset: { symbol: 'sUSDe' }, debtAsset: { symbol: 'USDC' }, maxLtv: 0.86 });
  });
});

describe('render', () => {
  it('lists the positions in Persian with the incomplete label', async () => {
    const { renderToString } = await import('react-dom/server');
    const { EarnSection } = await import('../../src/components/portfolio/EarnSection');
    const { assertPersianMoney } = await import('../helpers/text');
    const html = renderToString(<EarnSection earn={[pos(), pos({ id: 'p2', family: 'leverage', debtAsset: { symbol: 'USDC', address: null }, asset: { symbol: 'sUSDe', address: null } })]} saveEarn={() => {}} removeEarn={() => {}} />);
    for (const t of ['سپرده، خزانه، نرخ ثابت، لوپ و LP', 'برآورد ناقص', 'وام‌دهی', 'لوپ (اهرم)', 'ارزش خالص']) expect(html).toContain(t);
    expect(html).not.toContain('NaN');
    assertPersianMoney(html.replace(/title="[^"]*"/g, '').replace(/href="[^"]*"/g, '').replace(/<bdi dir="ltr"[^>]*>[^<]*<\/bdi>/g, ''));
  });
});
