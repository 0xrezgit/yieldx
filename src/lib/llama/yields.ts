/**
 * DefiLlama Yields (free API, no key): the pool list YieldX verifies on-chain itself
 * (see `verify.ts`), and the dashboard's pre-configured filters applied to the result.
 * DefiLlama's own «Verified» results, holders and simulations are in its paid API only.
 */

// ─── Raw shapes (yields.llama.fi, api.llama.fi) ─────────────────────────────

export interface RawPool {
  pool: string;
  chain: string;
  project: string;
  symbol: string;
  poolMeta?: string | null;
  tvlUsd: number;
  apy?: number | null;
  apyBase?: number | null;
  apyReward?: number | null;
  apyMean30d?: number | null;
  apyPct30D?: number | null;
  stablecoin?: boolean;
  ilRisk?: string | null;
  exposure?: string | null;
  outlier?: boolean;
  rewardTokens?: string[] | null;
  count?: number | null;
}

export interface RawProtocol {
  slug?: string;
  name?: string;
  category?: string | null;
  audits?: string | null;
  logo?: string | null;
}

// ─── The app's row ───────────────────────────────────────────────────────────

export interface YieldPool {
  id: string;
  chain: string;
  /** DefiLlama project slug (also its logo and page). */
  project: string;
  projectName: string;
  category: string | null;
  /** DefiLlama's audit flag for the protocol: anything but "0" counts as audited. */
  audited: boolean;
  symbol: string;
  meta: string | null;
  tvlUsd: number;
  /** Percent a year. Base = the pool's own yield; reward = incentive tokens. */
  apy: number | null;
  apyBase: number | null;
  apyReward: number | null;
  apyMean30d: number | null;
  stablecoin: boolean;
  single: boolean;
  ilRisk: boolean;
  /** DefiLlama's own outlier flag (its model, not ours). */
  outlier: boolean;
  /** Today's rate far above its 30-day average: almost always a one-day spike. */
  spike: boolean;
  /** Days of history DefiLlama has for the pool. */
  days: number | null;
}

export const SPIKE = { minPct: 20, ratio: 3 } as const;

/** A rate of more than `ratio`× its 30-day mean and above `minPct`: a spike, not a yield. */
export function isSpike(apy: number | null, mean30d: number | null): boolean {
  if (apy === null || !(apy > SPIKE.minPct)) return false;
  return mean30d === null || !(mean30d > 0) || apy > SPIKE.ratio * mean30d;
}

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);

export function toPool(p: RawPool, protocols: Map<string, RawProtocol>): YieldPool | null {
  const tvl = num(p.tvlUsd);
  if (!p.pool || !p.symbol || tvl === null) return null;
  const pr = protocols.get(p.project);
  const apy = num(p.apy);
  const apyMean30d = num(p.apyMean30d);
  return {
    id: p.pool,
    chain: p.chain,
    project: p.project,
    projectName: pr?.name ?? p.project,
    category: pr?.category ?? null,
    audited: !!pr?.audits && pr.audits !== '0',
    symbol: p.symbol,
    meta: p.poolMeta?.trim() || null,
    tvlUsd: tvl,
    apy,
    apyBase: num(p.apyBase),
    apyReward: num(p.apyReward),
    apyMean30d,
    stablecoin: p.stablecoin === true,
    single: p.exposure === 'single',
    ilRisk: p.ilRisk === 'yes',
    outlier: p.outlier === true,
    spike: isSpike(apy, apyMean30d),
    days: num(p.count),
  };
}

// ─── Token classes (by symbol; a pool's symbol is its tokens joined by "-") ──

const parts = (symbol: string) =>
  symbol
    .toUpperCase()
    .split(/[-/+ ]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const STABLE = /^(W|S|A|C|ST|X|F|K|M)?(USDC(\.E|\.N)?|USDT0?|USD₮0?|USDE|USDS|DAI|GHO|FRXUSD|PYUSD|RLUSD|USDG|AUSD|USD0|USD1|USDH|BOLD|LUSD|CRVUSD|FDUSD|TUSD|USDB|USDX|DOLA|MIM|SUSD|AVUSD|USDAI|USDTB|EUSD|FEUSD|USDM|USDBC|BUSD|FRAX|ALUSD|MSUSD|REUSD|DUSD|FXUSD|SCRVUSD|SYRUPUSDC|SUSDS|SUSDE|SUSDAI|SDOLA|3CRV|FRAXBP)$/;
const BTC = /^(BTC|WBTC|CBBTC|TBTC|LBTC|BTCB|BTC\.B|WBTC\.B|SOLVBTC|FBTC|UBTC|KBTC|XBTC|ENZOBTC|UNIBTC|PUMPBTC)$/;
const ETH = /^(ETH|WETH|WETH\.E|STETH|WSTETH|WEETH|EETH|RETH|CBETH|EZETH|RSETH|METH|OETH|WOETH|FRXETH|SFRXETH|PUFETH|ETHX|UETH|OSETH|SWETH|ANKRETH|ALETH)$/;
const SOL = /^(SOL|WSOL|JITOSOL|MSOL|BSOL|JUPSOL|INF|BNSOL|HSOL|VSOL|DSOL|LST|STSOL|FRAGSOL|BBSOL|CGNTSOL)$/;
/** Tokenised gold, silver and oil. EGLD, AGLD and GOLDEN are not (MultiversX, Adventure Gold, memes). */
const COMMODITY = /^(XAUT0?|XAUT₮?|PAXG|PAXGOLD|XAUM|XAU|XAUE|XAUH|VNXAU|KAU|KAG|DGLD|TGLD|GLDT|GLDX|GLDY|PGOLD|GOLDN|XGLD|SEGLD|XAG|XAGM|SILVER|CGO|DGX|GOLDGR)$/;

export type TokenKind = 'usd' | 'btc' | 'eth' | 'sol' | 'commodity' | 'other';

export function tokenKind(token: string): TokenKind {
  const t = token.toUpperCase().replace(/ᅠ/g, '').trim();
  if (STABLE.test(t)) return 'usd';
  if (BTC.test(t)) return 'btc';
  if (ETH.test(t)) return 'eth';
  if (SOL.test(t)) return 'sol';
  if (COMMODITY.test(t)) return 'commodity';
  return 'other';
}

export const kinds = (symbol: string) => parts(symbol).map(tokenKind);

// ─── Pre-configured filters (as on DefiLlama's dashboard) ───────────────────

export type PresetId = 'all' | 'stables' | 'majors' | 'commodities' | 'lst' | 'safe' | 'high';

export interface Preset {
  id: PresetId;
  label: string;
  /** What the preset keeps, in one line for the screen. */
  rule: string;
  test: (p: YieldPool) => boolean;
}

export const PRESETS: Preset[] = [
  { id: 'all', label: 'همه', rule: 'همه‌ی خزانه‌هایی که بازده و برداشتشان روی زنجیره تأیید شد.', test: () => true },
  { id: 'stables', label: 'استیبل‌کوین', rule: 'استخرهای استیبل‌کوین با نقدینگی ۱ میلیون دلار و بیشتر.', test: (p) => p.stablecoin && p.tvlUsd >= 1e6 },
  {
    id: 'majors',
    label: 'دارایی‌های اصلی',
    rule: 'فقط BTC، ETH، SOL و استیبل‌کوین‌ها؛ پروتکل حسابرسی‌شده؛ نقدینگی ۱۰ میلیون دلار و بیشتر.',
    test: (p) => p.audited && p.tvlUsd >= 1e7 && kinds(p.symbol).every((k) => k === 'usd' || k === 'btc' || k === 'eth' || k === 'sol'),
  },
  { id: 'commodities', label: 'کالاها', rule: 'طلا، نقره و نفت توکنیزه؛ نقدینگی ۱۰۰ هزار دلار و بیشتر.', test: (p) => p.tvlUsd >= 1e5 && kinds(p.symbol).includes('commodity') },
  { id: 'lst', label: 'استیکینگ نقدشونده', rule: 'پروتکل‌های دسته‌ی Liquid Staking؛ حسابرسی‌شده؛ نقدینگی ۱ میلیون دلار و بیشتر.', test: (p) => p.category === 'Liquid Staking' && p.audited && p.tvlUsd >= 1e6 },
  { id: 'safe', label: 'پناهگاه امن', rule: 'استخرهای تک‌دارایی؛ حسابرسی‌شده؛ نقدینگی ۱۰ میلیون دلار و بیشتر.', test: (p) => p.single && p.audited && p.tvlUsd >= 1e7 },
  { id: 'high', label: 'بازده بالا', rule: 'بازده ۱۰٪ و بیشتر؛ حسابرسی‌شده؛ نقدینگی ۱ میلیون دلار و بیشتر.', test: (p) => p.audited && p.tvlUsd >= 1e6 && (p.apy ?? 0) >= 10 },
];

export const presetById = (id: string) => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

/** The preset and every search word (symbol, project, chain, pool name). */
export function matches(p: YieldPool, preset: PresetId, q: string): boolean {
  if (!presetById(preset).test(p)) return false;
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${p.symbol} ${p.projectName} ${p.project} ${p.chain} ${p.meta ?? ''}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}

// ─── Links and logos ─────────────────────────────────────────────────────────

export const poolUrl = (id: string) => `https://defillama.com/yields/pool/${encodeURIComponent(id)}`;
export const addressUrl = (explorer: string, address: string) => `${explorer}/address/${address}`;
export const projectLogo = (slug: string) => `https://icons.llamao.fi/icons/protocols/${encodeURIComponent(slug)}?w=48&h=48`;
export const chainLogo = (chain: string) => `https://icons.llamao.fi/icons/chains/rsz_${encodeURIComponent(chain.toLowerCase())}?w=48&h=48`;
