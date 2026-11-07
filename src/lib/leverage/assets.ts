/**
 * One underlying for the many tokens that track it: cbBTC, xBTC and WBTC are «BTC»;
 * JitoSOL and mSOL are «SOL»; TSLAx (xStocks, Solana) and TSLAc (Coinbase, Base) are
 * «TSLA». The leverage comparison groups venues by this, and each row still names its
 * own token and network — two tokens of one stock are not the same thing.
 *
 * `perp` is the Hyperliquid coin for the same price view (stocks on the «xyz» dex);
 * null when there is none. `exact` is false when the token only follows that price
 * (a liquid-staking token, an index ETF against its index).
 */

export type AssetKind = 'crypto' | 'stocks';

export interface Underlying {
  /** Grouping key and label: «BTC», «SOL», «TSLA». */
  asset: string;
  kind: AssetKind;
  perp: string | null;
  /** The token's price is the perp's price (not a staking token or an ETF against an index). */
  exact: boolean;
  /** Deep markets on every venue: swaps of a few hundred thousand dollars move the price little. */
  major: boolean;
}

const CRYPTO: { asset: string; re: RegExp; perp: string | null; exact: RegExp; major: boolean }[] = [
  { asset: 'BTC', re: /^(w?btc|cbbtc|tbtc|xbtc|lbtc|fbtc)$/i, perp: 'BTC', exact: /^(w?btc|cbbtc|xbtc)$/i, major: true },
  { asset: 'ETH', re: /^(w?eth|wsteth|steth|weeth|reth|cbeth)$/i, perp: 'ETH', exact: /^w?eth$/i, major: true },
  { asset: 'SOL', re: /^(w?sol|jitosol|jupsol|msol|psol|bsol|inf|hsol|dsol|bbsol)$/i, perp: 'SOL', exact: /^w?sol$/i, major: true },
  { asset: 'HYPE', re: /^(w?hype|khype|sthype)$/i, perp: 'HYPE', exact: /^w?hype$/i, major: false },
  { asset: 'ZEC', re: /^zec$/i, perp: 'ZEC', exact: /^zec$/i, major: false },
  { asset: 'PAXG', re: /^(paxg|pax gold)$/i, perp: 'PAXG', exact: /^(paxg|pax gold)$/i, major: false },
  { asset: 'JLP', re: /^jlp$/i, perp: null, exact: /^$/, major: false },
];

/** Stock perps on Hyperliquid's «xyz» dex whose name is not the ticker (an ETF against its index). */
const STOCK_PERP: Record<string, string | null> = { SPY: 'xyz:SP500', QQQ: null };

/**
 * The underlying of a token. `kind` comes from the source when it knows it (PendleLoop's
 * «stocks» category); otherwise a tokenised stock is recognised by its issuer's suffix:
 * xStocks «x» (TSLAx), Coinbase «c» (TSLAc), Ondo «on» (TSLAon).
 */
export function underlyingOf(symbol: string, kind?: AssetKind): Underlying | null {
  const s = symbol.trim();
  if (kind !== 'stocks') {
    const c = CRYPTO.find((x) => x.re.test(s));
    if (c) return { asset: c.asset, kind: 'crypto', perp: c.perp, exact: c.exact.test(s), major: c.major };
    if (kind === 'crypto') return null;
  }
  const m = s.match(/^([A-Z]{1,6})(x|c|on)$/) ?? (kind === 'stocks' ? s.match(/^([A-Z]{1,6})()$/) : null);
  if (!m) return null;
  const ticker = m[1];
  const perp = ticker in STOCK_PERP ? STOCK_PERP[ticker] : `xyz:${ticker}`;
  return { asset: ticker, kind: 'stocks', perp, exact: !(ticker in STOCK_PERP), major: false };
}
