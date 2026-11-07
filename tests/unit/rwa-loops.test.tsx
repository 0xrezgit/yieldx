import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BorrowSide, Opportunity } from '../../src/types/opportunity';
import { buildLoops, defaultLeverageInput } from '../../src/lib/opportunity/leverage';
import { estimate } from '../../src/lib/opportunity/estimate';
import { isDollarDebt, rwaOf } from '../../src/lib/opportunity/rwa';
import { badgesOf } from '../../src/lib/market/labels';
import { FAMILY_FILTERS } from '../../src/lib/market/analysis';
import { RwaCallout, RwaIntro } from '../../src/components/market/RwaParts';

// Kamino's RWA markets as the lending source sends them (addresses real, rates for the test).
const NOW = Date.parse('2026-11-08T00:00:00Z');
const AT = new Date(NOW).toISOString();
const SOL = 'solana:mainnet';
const ONYC = '5Y8NV33Vv7WbnLfq3zBcKSdYPrk7g2KoiQoe7M2tcxp5';
const AUTO = 'GNE6oDS6jHrfaV3GQVVCCp37fDnT7PiPuewMKBj2bqNm';
const WYLDS = '8fr7WGTVFszfyNWRMXj6fRjZZAnDwmXwEpCrtzmUkdih';
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const STRCX = 'Xs78JED6PFZxWc2wCEPspZW9kL3Se5J7L5TChKgsidH';

const side = (collateral: BorrowSide['collateral'], over: Partial<BorrowSide> = {}): BorrowSide => ({ ratePct: 7.6, curve: null, availableUsd: 5e6, collateral, metric: 'ltv', ...over });
const lend = (key: string, debt: { symbol: string; address: string }, borrow: BorrowSide): Opportunity => ({
  key,
  family: 'lend',
  protocol: { id: 'kamino', version: 'klend', name: 'Kamino' },
  chain: SOL,
  market: { id: key, address: null, name: `${debt.symbol} · RWA Market` },
  assets: { deposit: [debt] },
  rate: { value: 5, kind: 'apy', feesIncluded: true, rewardsIncluded: false, at: AT },
  maturity: null,
  capacity: { depositRemainingUsd: null, uncapped: true, withdrawableNowUsd: 1e9 },
  exit: { type: 'instant' },
  rewards: [],
  borrow,
  quality: 'current',
  sources: [],
});
const coll = (symbol: string, address: string, pct: number, borrowLtv = 0.66) => ({ token: { symbol, address }, maxLtv: 0.75, borrowLtv, yield: { pct, kind: 'apy' as const, source: 'Kamino' } });

describe('RWA loops (dollar-NAV collateral, src/config/rwa.json)', () => {
  const opps = [
    lend('onre-usdc', { symbol: 'USDC', address: USDC }, side([coll('ONyc', ONYC, 11.02)])),
    lend('auto-wylds', { symbol: 'wYLDS', address: WYLDS }, side([coll('AUTO', AUTO, 11.68, 0.78)], { ratePct: 6.25, fixedTermDays: 30 })),
    lend('strcx-usdc', { symbol: 'USDC', address: USDC }, side([coll('STRCx', STRCX, 9)])),
  ];
  const loops = buildLoops(opps);

  it('loops ONyc on USDC and AUTO on wYLDS (a $1 debt its symbol does not show); never STRCx, a price bet', () => {
    expect(loops.map((l) => l.loop!.collateral.token.symbol).sort()).toEqual(['AUTO', 'ONyc']);
    expect(isDollarDebt(SOL, WYLDS)).toBe(true);
    expect(rwaOf(SOL, STRCX)).toBeNull();
    // Solana addresses are case-sensitive: a lowercased one is another address.
    expect(rwaOf(SOL, ONYC.toLowerCase())).toBeNull();
  });

  it('a dollar NAV is not a peg: unverified, its issuer and backing on the loop', () => {
    const onyc = loops.find((l) => l.loop!.collateral.token.symbol === 'ONyc')!;
    expect(onyc.loop).toMatchObject({ pairClass: 'usd', pegVerified: false, rwa: { issuer: 'OnRe' } });
    expect(onyc.notes!.join(' ')).toContain('NAV');
  });

  it('is costed at the cautious leverage, under the protocol’s own borrow limit', () => {
    const onyc = loops.find((l) => l.loop!.collateral.token.symbol === 'ONyc')!;
    const e = estimate(onyc, { capital: 1000, days: 30, now: NOW, leverage: defaultLeverageInput });
    expect(e.leverage!.leverage).toBeLessThanOrEqual(2.5);
    expect(e.leverage!.leverage).toBeLessThanOrEqual(1 / (1 - 0.66) + 1e-9);
    expect(e.assumptions.join(' ')).toContain('RWA');
  });

  it('a market that cannot lend is set aside as «no capacity», not ranked', () => {
    const [full] = buildLoops([lend('onre-full', { symbol: 'USDC', address: USDC }, side([coll('ONyc', ONYC, 11.02)], { availableUsd: 0 }))]);
    expect(estimate(full, { capital: 1000, days: 30, now: NOW, leverage: defaultLeverageInput }).placement).toBe('no-capacity');
  });

  it('carries its badge first, and has a filter of its own', () => {
    const onyc = loops.find((l) => l.loop!.collateral.token.symbol === 'ONyc')!;
    const e = estimate(onyc, { capital: 1000, days: 30, now: NOW, leverage: defaultLeverageInput });
    expect(badgesOf(e, onyc)[0]).toBe('RWA · ریسک اعتباری');
    expect(FAMILY_FILTERS.map((f) => f.id)).toContain('rwa');
  });

  it('renders its risk panel and the filter’s intro in Persian', () => {
    const html = renderToStaticMarkup(<RwaCallout rwa={rwaOf(SOL, ONYC)!} />) + renderToStaticMarkup(<RwaIntro ranked={3} waiting={12} />);
    for (const t of ['دارایی واقعی (RWA)', 'بیمه‌ی اتکایی', 'ظرفیت پر', 'قابل ورود']) expect(html).toContain(t);
    expect(html).not.toContain('NaN');
  });
});
