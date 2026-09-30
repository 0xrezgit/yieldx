import { describe, expect, it } from 'vitest';
import raw from '../fixtures/merkl-live-2026-09-30.json';
import { normalizeOpportunity, type RawOpportunity } from '../../src/lib/merkl/normalize';
import { DEX_CHAINS, marketFromPairs } from '../../src/lib/merkl/markets';
import { buildContext, checkRewardPrice, dedupe, gate, isMeme, RULES, suspicion, type VetContext } from '../../src/lib/merkl/vetting';
import { calcCampaign, CONSERVATIVE, estimate, nativeYield, poolFeeTier, sellImpact, type Estimate, type EstimateSettings, type NoEstimate } from '../../src/lib/merkl/profit';
import { flags, hasRobinhoodMeme, liveAt } from '../../src/lib/merkl/filters';
import { tokenKey, type GasQuote, type MerklOpportunity, type TokenMarket } from '../../src/lib/merkl/types';

/**
 * Real Merkl API v4 responses and DexScreener markets captured on 2026-09-30,
 * trimmed to the fields YieldX reads. NOW is the capture time. Where a case does
 * not occur in live data (a fake token, a meme with enough TVL), a real
 * opportunity is copied and one field is changed — each such change is named.
 */
const fx = raw as unknown as { capturedAt: number; opportunities: RawOpportunity[]; markets: Record<string, TokenMarket | null> };
const NOW = fx.capturedAt;
const DAY = 86_400;
const ops = fx.opportunities.map((o) => normalizeOpportunity(o, NOW)).filter((o): o is MerklOpportunity => o !== null);
const byId = (id: string) => {
  const o = ops.find((x) => x.id === id);
  if (!o) throw new Error(`missing ${id}`);
  return o;
};
const chains = Object.keys(DEX_CHAINS).map(Number);
const ctxFor = (list: MerklOpportunity[], markets = fx.markets): VetContext => buildContext(list, markets, chains, NOW);
const ctx = ctxFor(ops);
const gas: GasQuote[] = [{ chainId: 1, gwei: 0.263, nativeUsd: 2700, at: NOW * 1000 }];
const S: EstimateSettings = { capital: 1000, horizon: 30, txEthereum: 1, txOther: 0.05 };
const est = (o: MerklOpportunity, s: EstimateSettings = S, c: VetContext = ctx) => {
  const e = estimate(o, s, c, gas);
  if (e.ok === false) throw new Error(`no estimate: ${e.reason.label}`);
  return e as Estimate;
};
const why = (o: MerklOpportunity, s: EstimateSettings = S, c: VetContext = ctx) => {
  const g = gate(o, c);
  if (g) return g.code;
  const e = estimate(o, s, c, gas);
  return e.ok ? null : (e as NoEstimate).reason.code;
};
const clone = (o: MerklOpportunity): MerklOpportunity => JSON.parse(JSON.stringify(o));

const CARROT_POOL = '13838986704660549008'; // Uniswap CARROT-USDC, $20k TVL, shared budget
const AAVE_TARGET = '16069439808187088621'; // Aave Horizon RLUSD, net-APR target 5%
const MORPHO_USD3 = '17336152193148221388'; // measured native supply APR ~26%
const SPICE = '8405174926109779519'; // declared native 15% without a measurement
const FX_TWO = '7372973958820558993'; // two FXN campaigns, different end dates
const IPOR_POINTS = '2126413745273788406'; // USDC capped + IPOR points
const USP_PRETGE = '17216643690669966223'; // PIKU pre-TGE
const BORROW = '699654958170586655';
const CLAWBANK = '8329770141962261204'; // Robinhood Chain ETH-ClawBank LP
const ARGT = '11859569989119475260'; // Argentine-peso token: tiny price, not a meme
const GEARBOX = '7554939082438499556'; // GEAR reward: tiny price, not a meme
const YT = '7833282965192764162';
const CLMM = '4746947644538515987';
const ROBINHOOD_ONLY = '5701731715065456649';
const TEST = '9711572388255894453';
const SKY = '16088678467640585746'; // USDS with a deprecated Merkl price source
const MENTO = '7086097570508038658';

describe('normalize: relations and freshness fields', () => {
  it('keeps programs, per-campaign ids, reward chain and native-yield provenance', () => {
    const rh = byId(ROBINHOOD_ONLY);
    expect(rh.programs.map((p) => p.slug)).toContain('robinhood');
    for (const c of rh.campaigns) expect(c.campaignId).toMatch(/^0x/);
    const usd3 = byId(MORPHO_USD3);
    expect(usd3.nativeSource).toContain('Morpho');
    expect(usd3.nativeAt).not.toBeNull();
    expect(byId(SPICE).nativeSource).toBeNull();
    expect(byId(CARROT_POOL).campaigns[0].distributionChainId).toBe(1);
  });

  it('drops campaigns once they end, even between refreshes', () => {
    const o = byId(FX_TWO);
    const firstEnd = Math.min(...o.campaigns.map((c) => c.end));
    expect(liveAt(o, firstEnd + 1).campaigns).toHaveLength(1);
    expect(liveAt(o, NOW).campaigns).toHaveLength(2);
  });

  it('de-duplicates one market reached twice (program + protocol) by identity', () => {
    const o = byId(MENTO);
    const twin = { ...clone(o), id: 'other-id' };
    expect(dedupe([o, twin])).toHaveLength(1);
    expect(dedupe([o, o])).toHaveLength(1);
  });
});

describe('estimated net profit', () => {
  it('uses the user’s diluted share, not the whole campaign’s daily reward', () => {
    const o = byId(CARROT_POOL);
    const c = o.campaigns[0];
    const e = est(o);
    const tvl = (c.dailyUsd * 365) / (c.apr / 100);
    const share = e.deployed / (tvl + e.deployed);
    const days = Math.min(30, (c.end - NOW) / DAY);
    expect(e.incentiveUsd).toBeCloseTo(c.dailyUsd * share * days, 6);
    expect(e.incentiveUsd).toBeLessThan(c.dailyUsd * days * 0.1);
    // The personal APR after joining is below Merkl's pool average.
    expect(e.incentiveApr).toBeLessThan(c.apr);
  });

  it('re-ranks with the amount: a thin pool dilutes, a large market does not', () => {
    const small = est(byId(CARROT_POOL), { ...S, capital: 1000 });
    const big = est(byId(CARROT_POOL), { ...S, capital: 100_000 });
    expect(big.net / 100_000).toBeLessThan((small.net / 1000) * 0.5);
    const aSmall = est(byId(MORPHO_USD3), { ...S, capital: 1000 });
    const aBig = est(byId(MORPHO_USD3), { ...S, capital: 100_000 });
    expect(aBig.net / 100_000).toBeGreaterThan((aSmall.net / 1000) * 0.95);

    // The amount re-orders them by net: the pool's shared budget dilutes, the lending rate does not.
    expect(est(byId(CARROT_POOL), { ...S, capital: 1000 }).net).toBeGreaterThan(est(byId(MORPHO_USD3), { ...S, capital: 1000 }).net);
    expect(est(byId(CARROT_POOL), { ...S, capital: 100_000 }).net).toBeLessThan(est(byId(MORPHO_USD3), { ...S, capital: 100_000 }).net);
  });

  it('counts each campaign only to its own end within the common horizon', () => {
    const o = byId(FX_TWO);
    const [a, b] = [...o.campaigns].sort((x, y) => x.end - y.end);
    const e7 = est(o, { ...S, horizon: 7 });
    const e90 = est(o, { ...S, horizon: 90 });
    const days = (h: number, end: number) => Math.min(h, (end - NOW) / DAY);
    const perDay = (e: Estimate, id: string) => e.campaigns.find((x) => x.c.id === id)!.usdPerDay!;
    expect(e7.incentiveUsd).toBeCloseTo(perDay(e7, a.id) * 7 + perDay(e7, b.id) * 7, 6);
    expect(e90.incentiveUsd).toBeCloseTo(perDay(e90, a.id) * days(90, a.end) + perDay(e90, b.id) * days(90, b.end), 6);
    // Both end before 90 days: the 90-day incentive is capped by the end dates, not tripled.
    expect(e90.incentiveUsd).toBeLessThan((e7.incentiveUsd / 7) * 90);
    // Net to the campaigns' own ends is shown separately.
    expect(e90.daysToEnd).toBeCloseTo((b.end - NOW) / DAY, 6);
  });

  it('never counts the native yield twice when a campaign targets a net APR', () => {
    const o = byId(AAVE_TARGET);
    expect(o.campaigns[0].rateKind).toBe('target');
    const e = est(o);
    const c = e.campaigns[0];
    // Merkl pays only the gap to the target: incentive + native ≈ the 5% target, not 5% + native.
    const combinedApr = c.apr! + e.native.apr;
    expect(combinedApr).toBeCloseTo(o.campaigns[0].apr, 1);
    expect(combinedApr).toBeLessThan(o.campaigns[0].apr + e.native.apr - 1);
  });

  it('does not add a native yield Merkl already reports inside the campaign APR', () => {
    const o = clone(byId(MORPHO_USD3));
    o.totalApr = o.apr; // Merkl's own sum equals the incentive: native is inside it
    const n = nativeYield(o, NOW);
    expect(n.counted).toBe(false);
    expect(n.note).toContain('دوباره‌شماری');
  });

  it('counts a measured native yield, not a declared or stale one', () => {
    expect(nativeYield(byId(MORPHO_USD3), NOW).counted).toBe(true);
    expect(nativeYield(byId(SPICE), NOW).counted).toBe(false);
    const old = clone(byId(MORPHO_USD3));
    old.nativeAt = NOW - 3 * DAY;
    expect(nativeYield(old, NOW).counted).toBe(false);
  });

  it('separates measured, assumed and model costs and lists the unknown ones', () => {
    const eth = est(byId(MORPHO_USD3));
    expect(eth.costs.find((c) => c.key === 'gas-entry')!.basis).toBe('measured');
    expect(eth.deployed).toBeCloseTo(1000 - eth.costs.find((c) => c.key === 'gas-entry')!.usd, 9);
    expect(eth.net).toBeCloseTo(eth.incentiveUsd + eth.nativeUsd - eth.knownCostUsd, 9);
    expect(eth.unknownCosts.join()).toContain('vault');

    const monad = est(byId(MENTO));
    expect(monad.costs.find((c) => c.key === 'gas-entry')!.basis).toBe('assumed');
    expect(monad.costs.find((c) => c.key === 'gas-entry')!.usd).toBeCloseTo(3 * S.txOther, 9);
    const pricier = est(byId(MENTO), { ...S, txOther: 1 });
    expect(pricier.net).toBeLessThan(monad.net);

    // FXN has a known DEX market → the price impact of selling the rewards is a model cost.
    const fxn = est(byId(FX_TWO));
    expect(fxn.costs.some((c) => c.key === 'sell-impact' && c.basis === 'model')).toBe(true);
    // mtwCARROT (a wrapper) has no DEX pair → the impact is listed as unknown, not guessed.
    const pool = byId(CARROT_POOL);
    const carrot = est(pool);
    expect(carrot.costs.some((c) => c.key === 'sell-impact')).toBe(false);
    expect(carrot.unknownCosts.join()).toContain('mtwCARROT');
    expect(carrot.why.join()).toContain('mtwCARROT');
    expect(sellImpact(1000, 1_000_000)).toBeCloseTo((1000 * 1000) / (500_000 + 1000), 9);
    expect(poolFeeTier({ ...pool, name: 'Provide liquidity to UniswapV4 SPY-NVDA 0.05%' })).toBeCloseTo(0.0005, 9);
    expect(poolFeeTier({ ...pool, action: 'LEND', name: 'Supply USDC on USD3/USDC 91.5%' })).toBeNull();
  });

  it('shows a conservative scenario below the base one', () => {
    const e = est(byId(CARROT_POOL));
    expect(e.netLow).toBeLessThan(e.net);
    const c = e.campaigns[0];
    const tvl = (c.c.dailyUsd * 365) / (c.c.apr / 100);
    const lowShare = e.deployed / (tvl * (1 + CONSERVATIVE.tvlUp) + e.deployed);
    expect(c.usdPerDayLow).toBeCloseTo(c.c.dailyUsd * lowShare * (1 - CONSERVATIVE.priceDown), 9);
  });
});

describe('prices, points and pre-TGE', () => {
  it('refuses dollars for a thin, gapped or missing price and explains why', () => {
    const o = byId(CARROT_POOL);
    const t = o.campaigns[0].rewardToken;
    const key = tokenKey(t.chainId, t.address);
    const m = fx.markets[key]!;
    const thin = ctxFor(ops, { ...fx.markets, [key]: { ...m, liquidityUsd: RULES.minRewardLiquidity - 1 } });
    expect(why(o, S, thin)).toBe('thin');
    const gapped = ctxFor(ops, { ...fx.markets, [key]: { ...m, dexPrice: (t.price as number) * 2 } });
    expect(why(o, S, gapped)).toBe('price-gap');
    const noPrice = clone(o);
    noPrice.campaigns[0].rewardToken.price = null;
    expect(why(noPrice)).toBe('no-price');
  });

  it('prices a verified stablecoin at its peg even when Merkl’s price source is deprecated', () => {
    const o = byId(SKY);
    const t = o.campaigns[0].rewardToken;
    expect(t.priceSource).toMatch(/deprecated/i);
    const p = checkRewardPrice(t, ctx);
    expect(p.ok).toBe(true);
    expect(p.caveats.join()).toContain('دلار');
  });

  it('keeps points out of dollars, counted only in their own unit', () => {
    const o = byId(IPOR_POINTS);
    const e = est(o);
    const pts = e.campaigns.find((x) => x.c.rewardToken.type === 'POINT')!;
    expect(pts.usdPerDay).toBeNull();
    expect(pts.unitsPerDay).toBeGreaterThan(0);
    const priced = e.campaigns.filter((x) => x.usdPerDay !== null).reduce((a, x) => a + x.usdPerDay! * x.days, 0);
    expect(e.incentiveUsd).toBeCloseTo(priced, 9);
  });

  it('shows pre-TGE amounts in units with no dollar value', () => {
    const o = clone(byId(USP_PRETGE));
    o.depositUrl = 'https://example.org/usp'; // the live copy has no deposit link, which the gate requires
    expect(o.campaigns[0].rewardToken.type).toBe('PRETGE');
    expect(why(o)).toBe('units-only');
    const x = calcCampaign(o.campaigns[0], o, 1000, 30, ctxFor([o]));
    expect(x.usdPerDay).toBeNull();
  });
});

describe('selection', () => {
  it('excludes what cannot be estimated honestly, with the reason', () => {
    expect(why(byId(BORROW))).toBe('borrow');
    expect(why(byId(YT))).toBe('low-tvl');
    const yt = clone(byId(YT));
    yt.tvl = 1_000_000;
    yt.apr = 50;
    expect(why(yt)).toBe('yt');
    expect(why(byId(CLMM))).toBe('model');
    expect(why(byId(ROBINHOOD_ONLY))).toBe('restricted');
    expect(why(byId(TEST))).toBe('test');
  });

  it('applies the published thresholds instead of bending them', () => {
    const o = clone(byId(MENTO));
    o.tvl = RULES.minTvl - 1;
    expect(gate(o, ctx)?.code).toBe('low-tvl');
    o.tvl = 1_000_000;
    o.aprAt = o.tvlAt = NOW - (RULES.recordMaxAgeH + 1) * 3600;
    expect(gate(o, ctx)?.code).toBe('stale');
    const absurd = clone(byId(MENTO));
    absurd.apr = RULES.absurdApr + 1;
    expect(gate(absurd, ctx)?.code).toBe('absurd-apr');
  });

  it('rejects a fake stablecoin and an unverified look-alike', () => {
    const o = clone(byId(MENTO));
    const t = o.campaigns[0].rewardToken;
    t.symbol = 'USDC';
    t.verified = false;
    t.price = 0.4;
    expect(suspicion(t, ctx)?.code).toBe('fake-price');
    expect(gate(o, ctx)?.code).toBe('fake-price');

    // An unverified copy of the verified FXN reward, same symbol and chain, triple the price.
    const look = clone(byId(MENTO));
    const real = byId(FX_TWO).campaigns[0].rewardToken;
    look.campaigns[0].rewardToken = { ...real, address: '0x000000000000000000000000000000000000dead', verified: false, price: (real.price as number) * 3 };
    expect(suspicion(look.campaigns[0].rewardToken, ctxFor([...ops, look]))?.code).toBe('lookalike');
  });

  it('does not treat a tiny unit price as a meme (GEAR, peso tokens)', () => {
    expect(isMeme(byId(GEARBOX).campaigns[0].rewardToken)).toBe(false);
    expect(isMeme(byId(ARGT).tokens[0])).toBe(false);
    expect(gate(byId(ARGT), ctx)).toBeNull();
  });

  it('allows a Robinhood-Chain memecoin only after the independent check, flagged very high risk', () => {
    const live = byId(CLAWBANK);
    expect(hasRobinhoodMeme(live)).toBe(true);
    // Live: $7k TVL — below the normal floor; the exception does not bypass it.
    expect(gate(live, ctx)?.code).toBe('low-tvl');

    const deep = clone(live);
    deep.tvl = 1_000_000;
    expect(gate(deep, ctx)).toBeNull();
    // A concentrated-liquidity pool: admissible, but no dollar figure is invented.
    expect(why(deep)).toBe('model');
    expect(flags(deep, NOW)[0].label).toContain('ریسک بسیار بالا');
    // The same pool as full-range liquidity: estimated, marked very high risk.
    const full = clone(deep);
    full.campaigns[0].clmm = false;
    const e = est(full);
    expect(e.meme).toBe(true);
    expect(e.confidence).toBe('low');
    expect(e.risks.join()).toContain('ریسک بسیار بالا');

    // The same meme elsewhere is excluded.
    const other = clone(deep);
    other.chain = { id: 8453, name: 'Base', icon: null };
    for (const t of other.tokens) if (isMeme(t)) t.chainId = 8453;
    expect(gate(other, ctx)?.code).toBe('meme');

    // Thin or mispriced on Robinhood Chain → excluded.
    const claw = deep.tokens.find((t) => isMeme(t))!;
    const key = tokenKey(claw.chainId, claw.address);
    const m = fx.markets[key]!;
    expect(gate(deep, ctxFor(ops, { ...fx.markets, [key]: { ...m, liquidityUsd: RULES.memeMinLiquidity - 1 } }))?.code).toBe('meme-liquidity');
    expect(gate(deep, ctxFor(ops, { ...fx.markets, [key]: { ...m, dexPrice: (claw.price as number) * 1.5 } }))?.code).toBe('meme-price-gap');
    const unverified = clone(deep);
    for (const t of unverified.tokens) if (isMeme(t)) t.verified = false;
    expect(gate(unverified, ctx)?.code).toBe('meme-unverified');
  });
});

describe('DexScreener markets', () => {
  it('sums liquidity across pairs and takes the price from the deepest base pair', () => {
    const a = '0xAbC0000000000000000000000000000000000001';
    const m = marketFromPairs(a, [
      { baseToken: { address: a.toLowerCase() }, priceUsd: '2', liquidity: { usd: 50_000 }, volume: { h24: 10 }, url: 'deep' },
      { baseToken: { address: a }, priceUsd: '3', liquidity: { usd: 1_000 }, volume: { h24: 5 } },
      { baseToken: { address: '0xother' }, quoteToken: { address: a }, priceUsd: '100', liquidity: { usd: 20_000 } },
      { baseToken: { address: '0xunrelated' }, priceUsd: '9', liquidity: { usd: 1e9 } },
    ])!;
    expect(m.liquidityUsd).toBe(71_000);
    expect(m.dexPrice).toBe(2);
    expect(m.pairs).toBe(3);
    expect(m.url).toBe('deep');
    expect(marketFromPairs(a, [])).toBeNull();
  });

  it('computes a campaign for units even when its token cannot be priced', () => {
    const o = byId(IPOR_POINTS);
    const pts = o.campaigns.find((c) => c.rewardToken.type === 'POINT')!;
    const x = calcCampaign(pts, o, 1000, 30, ctx);
    expect(x.status).not.toBe('none');
    expect(x.price.ok).toBe(false);
  });
});
