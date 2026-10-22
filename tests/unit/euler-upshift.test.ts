import { describe, expect, it } from 'vitest';
import { eulerBorrowSide, eulerOpportunity, liquidationLtvOf } from '../../src/lib/lending/euler';
import { decodeString, pointsOf, upshiftOpportunity, upshiftUrl, type UpshiftVault } from '../../src/lib/lending/upshift';
import { buildLoops } from '../../src/lib/opportunity/leverage';

// Controlled rows in the shape of the live answers (Euler Data API v3, Upshift tokenized_vault). Not market data.
const AT = '2026-10-23T00:00:00.000Z';
const NOW = Date.parse(AT);
const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const WSTETH = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0';
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const PT = '0x6876374E4AC054bfCA389109570Ae15b4d25e279';

const borrowVault = { chainId: 1, address: '0x1111111111111111111111111111111111111111', symbol: 'eWETH-1', asset: { address: WETH, symbol: 'WETH', decimals: 18 }, totalSupplyUsd: 5_000_000, totalBorrowsUsd: 3_000_000, utilization: 0.6, supplyApy: 1.8, borrowApy: 2.4, visibility: { status: 'visible', explorableLend: true, explorableBorrow: true } };
const collateralVault = { ...borrowVault, address: '0x2222222222222222222222222222222222222222', symbol: 'ewstETH-1', asset: { address: WSTETH, symbol: 'wstETH', decimals: 18 }, supplyApy: 0.3 };
const collaterals = [
  { collateral: collateralVault.address, asset: WSTETH, assetSymbol: 'wstETH', borrowLTV: '9300', liquidationLTV: '9500' },
  { collateral: '0x3333333333333333333333333333333333333333', asset: PT, assetSymbol: 'PT-reUSD-10DEC2026', borrowLTV: '8500', liquidationLTV: '8700' },
];
const byVault = new Map([borrowVault, collateralVault].map((v) => [v.address.toLowerCase(), v]));
const intrinsic = new Map([[WSTETH.toLowerCase(), 2.3]]);

describe('Euler (EVK vaults)', () => {
  it("reads a vault's collaterals with their LTVs, the asset's own yield and the collateral vault's supply rate", () => {
    const side = eulerBorrowSide(borrowVault, collaterals, byVault, intrinsic, NOW)!;
    expect(side.ratePct).toBe(2.4);
    expect(side.availableUsd).toBe(2_000_000);
    expect(side.collateral).toHaveLength(1);
    expect(side.collateral[0]).toMatchObject({ token: { symbol: 'wstETH' }, maxLtv: 0.95, borrowLtv: 0.93, yield: { pct: 2.3 }, supplyPct: 0.3 });
    expect(side.collateral[0].logo).toContain(`/images/tokens/1/${WSTETH}`);
  });

  it('leaves PT collaterals to PendleLoop (the same market twice would be two loop rows)', () => {
    const side = eulerBorrowSide(borrowVault, [collaterals[1]], byVault, intrinsic, NOW);
    expect(side).toBeNull();
  });

  it('takes the lower LTV while a liquidation LTV ramps down', () => {
    expect(liquidationLtvOf({ liquidationLTV: '8000', initialLiquidationLTV: '9000', rampDuration: 86400, targetTimestamp: '2026-11-01T00:00:00Z' }, NOW)).toBe(0.8);
    expect(liquidationLtvOf({ liquidationLTV: '8000', initialLiquidationLTV: '9000', rampDuration: 86400, targetTimestamp: '2026-10-01T00:00:00Z' }, NOW)).toBe(0.8);
    expect(liquidationLtvOf({ liquidationLTV: '9000', initialLiquidationLTV: '8000', rampDuration: 0 }, NOW)).toBe(0.9);
  });

  it('becomes a lending row with its market name, page and logo, and a loop on it', () => {
    const side = eulerBorrowSide(borrowVault, collaterals, byVault, intrinsic, NOW);
    const o = eulerOpportunity(borrowVault, side, { address: borrowVault.address, resolved: { name: 'K3 Capital Prime Market', entityId: 'k3-capital' } }, AT)!;
    expect(o).toMatchObject({ family: 'lend', protocol: { id: 'euler' }, chain: 'eip155:1', rate: { value: 1.8 }, market: { name: 'WETH · K3 Capital Prime Market' }, risk: { curator: 'k3-capital' } });
    expect(o.url).toBe(`https://app.euler.finance/lend/${borrowVault.address}?network=1`);
    expect(o.icon).toContain(`/images/tokens/1/${WETH}`);
    const [loop] = buildLoops([o]);
    expect(loop.loop).toMatchObject({ collateral: { token: { symbol: 'wstETH' } }, debt: { token: { symbol: 'WETH' } }, maxLtv: 0.95, borrowLtv: 0.93 });
    expect(loop.icon).toContain(WSTETH);
  });
});

describe('Upshift vaults', () => {
  const v: UpshiftVault = {
    address: '0x74aD2F789Ed583DBd141bbdafC673fE1F033718b',
    chain: 1,
    vault_name: 'Sentora USD',
    status: 'active',
    is_visible: true,
    public_type: 'DeFi Yield',
    tvl: 98_774_826,
    historical_compound_apy: { '1': 0.0739, '7': 0.0746, '30': 0.07557 },
    hardcoded_strategists: [{ strategist_name: 'Sentora' }],
    platform_fee_override: { management_fee: 0.2 },
    rewards: "[{'text': 'Upshift Points', 'multiplier': 5.0, 'id': 'x'}]",
    metrics_last_updated: '2026-10-22T16:16:23.875069',
  };

  it('takes the realised 30-day compounded rate (the «Total APY (30D)» Upshift shows)', () => {
    const o = upshiftOpportunity(v, { address: USDC, symbol: 'USDC' }, AT)!;
    expect(o.rate.value).toBeCloseTo(7.557, 3);
    expect(o).toMatchObject({ family: 'vault', protocol: { id: 'upshift' }, quality: 'partial', exit: { type: 'queue' }, assets: { deposit: [{ symbol: 'USDC' }] }, market: { name: 'Sentora USD · Sentora' } });
    expect(o.url).toBe('https://app.upshift.finance/vaults/ethereum/sentora-usd');
    expect(o.icon).toBeTruthy();
    expect(o.notes!.join(' ')).toContain('Upshift Points ×5');
  });

  it('builds the page from the network and the vault name', () => {
    expect(upshiftUrl({ chain: 143, vault_name: 'earnAUSD Looping Vault' })).toBe('https://app.upshift.finance/vaults/monad/earnausd-looping-vault');
  });

  it('reads points from the list or its Python-style text', () => {
    expect(pointsOf("[{'text': 'Upshift Points', 'multiplier': 5.0}]")).toEqual([{ name: 'Upshift Points', multiplier: 5 }]);
    expect(pointsOf([{ text: 'Kelp Miles', multiplier: 3 }])).toEqual([{ name: 'Kelp Miles', multiplier: 3 }]);
    expect(pointsOf(null)).toEqual([]);
  });

  it('decodes a token symbol from its ABI string (or bytes32)', () => {
    const abi = '0x' + '20'.padStart(64, '0') + '4'.padStart(64, '0') + Buffer.from('USDC').toString('hex').padEnd(64, '0');
    expect(decodeString(abi)).toBe('USDC');
    expect(decodeString('0x' + Buffer.from('MKR').toString('hex').padEnd(64, '0'))).toBe('MKR');
  });
});
