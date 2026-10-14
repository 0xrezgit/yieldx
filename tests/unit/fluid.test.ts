import { describe, expect, it } from 'vitest';
import { fluidLending, fluidVault, type FluidFToken, type FluidVault } from '../../src/lib/lending/fluid';
import { buildLoops } from '../../src/lib/opportunity/leverage';
import { unitOf } from '../../src/lib/opportunity/goal';

// Shapes of api.fluid.instadapp.io/v2 (vaults and lending tokens, 2026-10-15); values controlled. Not market data.
const AT = '2026-10-15T00:00:00.000Z';
const ZERO = '0x0000000000000000000000000000000000000000';
const tok = (symbol: string, address: string, price: string, stakingApr?: string, decimals = 18) => ({ symbol, address, price, decimals, ...(stakingApr ? { stakingApr } : {}) });
const none = { address: ZERO };
const vault = (over: Partial<FluidVault>): FluidVault => ({
  id: '1',
  type: '1',
  address: '0xVAULT',
  supplyToken: { token0: tok('sUSDe', '0xsusde', '1.2', '476'), token1: none },
  borrowToken: { token0: tok('USDT', '0xusdt', '1', undefined, 6), token1: none },
  collateralFactor: '9200',
  liquidationThreshold: '9400',
  supplyRate: { vault: { rate: '0' } },
  borrowRate: { vault: { rate: '571' } },
  borrowable: '2000000000000',
  ...over,
});

describe('Fluid', () => {
  it('fToken: supply rate in bps, withdrawable in asset units', () => {
    const t: FluidFToken = { address: '0xF', symbol: 'fUSDC', decimals: 6, asset: tok('USDC', '0xUSDC', '1', undefined, 6), supplyRate: '652', totalAssets: '132691194254097', liquiditySupplyData: { withdrawable: '12072149735272' } };
    const o = fluidLending(t, 1, AT)!;
    expect(o.rate.value).toBeCloseTo(6.52, 12);
    expect(o.capacity.withdrawableNowUsd).toBeCloseTo(12_072_149.735272, 4);
    expect(o.assets.deposit[0]).toEqual({ symbol: 'USDC', address: '0xusdc' });
  });

  it('T1: collateral factor is the borrow limit, the liquidation threshold the health line; the token’s own yield', () => {
    const o = fluidVault(vault({}), 1, AT)!;
    expect(o.family).toBe('borrow');
    expect(o.borrow).toMatchObject({ ratePct: 5.71, availableUsd: 2_000_000, metric: 'ltv' });
    expect(o.borrow!.collateral[0]).toMatchObject({ maxLtv: 0.94, borrowLtv: 0.92, yield: { pct: 4.76, kind: 'apr' } });
    const [loop] = buildLoops([o]);
    expect(loop.loop).toMatchObject({ pairClass: 'usd', maxLtv: 0.94, borrowLtv: 0.92 });
    expect(unitOf(loop)).toBe('usd');
  });

  it('T2 smart collateral: Σ share × (supply rate + own yield) + trading APR, shares by USD value of the reserves', () => {
    const v = vault({
      type: '2',
      supplyToken: { token0: tok('sUSDe', '0xsusde', '1', '500'), token1: tok('USDT', '0xusdt', '1', undefined, 6) },
      supplyRate: { liquidity: { token0: '0', token1: '400' }, dex: { trading: '50' }, vault: { rate: '0' } } as FluidVault['supplyRate'],
      // 25 % sUSDe, 75 % USDT (12-decimal reserves)
      supplyDexData: { address: '0xDEX', token0RealReserves: String(25e12), token1RealReserves: String(75e12) },
    });
    const o = fluidVault(v, 1, AT)!;
    const c = o.borrow!.collateral[0];
    expect(c.yield!.pct).toBeCloseTo(0.25 * 5 + 0.75 * 4 + 0.5, 12);
    expect(c.class).toBe('usd');
    expect(c.token.symbol).toBe('sUSDe+USDT');
    expect(buildLoops([o])).toHaveLength(1);
  });

  it('T3 smart debt: Σ share × borrow rate − trading APR; a debt of two classes is not one asset', () => {
    const v = vault({
      type: '3',
      borrowToken: { token0: tok('USDC', '0xusdc', '1', undefined, 6), token1: tok('USDT', '0xusdt', '1', undefined, 6) },
      borrowRate: { liquidity: { token0: '800', token1: '600' }, dex: { trading: '40' }, vault: { rate: '0' } } as FluidVault['borrowRate'],
      borrowDexData: { address: '0xDDEX', token0RealReserves: String(50e12), token1RealReserves: String(50e12) },
    });
    const o = fluidVault(v, 1, AT)!;
    expect(o.borrow!.ratePct).toBeCloseTo(0.5 * 8 + 0.5 * 6 - 0.4, 12);
    expect(o.borrow!.debtClass).toBe('usd');
    expect(o.borrow!.availableUsd).toBeNull();
    expect(buildLoops([o])).toHaveLength(1);
    const mixed = vault({ type: '3', borrowToken: { token0: tok('USDC', '0xusdc', '1'), token1: tok('ETH', '0xeth', '2400') } });
    expect(fluidVault(mixed, 1, AT)).toBeNull();
  });

  it('T4: both sides smart; an ETH pair is a loop counted in ETH, not dollars', () => {
    const v = vault({
      type: '4',
      supplyToken: { token0: tok('wstETH', '0xwst', '2900', '222'), token1: tok('ETH', '0xeth', '2400') },
      borrowToken: { token0: tok('wstETH', '0xwst', '2900'), token1: tok('ETH', '0xeth', '2400') },
      supplyRate: { liquidity: { token0: '4', token1: '180' }, dex: { trading: '9' } } as FluidVault['supplyRate'],
      borrowRate: { liquidity: { token0: '13', token1: '239' }, dex: { trading: '9' } } as FluidVault['borrowRate'],
      supplyDexData: { token0RealReserves: String(1e12), token1RealReserves: String(1e12) },
      borrowDexData: { token0RealReserves: String(1e12), token1RealReserves: String(1e12) },
    });
    const o = fluidVault(v, 1, AT)!;
    expect(o.protocol.version).toBe('vault-t4');
    const [loop] = buildLoops([o]);
    expect(loop.loop!.pairClass).toBe('eth');
    expect(unitOf(loop)).toBe('eth');
  });
});
