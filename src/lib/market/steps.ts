import type { Estimate, Opportunity } from '../../types/opportunity';
import { formatDate, formatNumber } from '../utils/formatting';

/**
 * «What to do, step by step» for one opportunity: where to go, what to do there, how
 * long to wait, and how the position ends in dollars (redeem, repay, claim, swap).
 * Built from the same data as the estimate, so the steps match the numbers shown.
 */

export type StepKind = 'deposit' | 'buy' | 'collateral' | 'loop' | 'wait' | 'watch' | 'claim' | 'redeem' | 'repay' | 'withdraw' | 'swap' | 'sell';

export interface Step {
  kind: StepKind;
  /** One or two words, for the compact strip. */
  short: string;
  /** One short line. */
  title: string;
  href?: string | null;
}

/** Latin symbols kept in one direction inside Persian text. */
const ltr = (s: string | null | undefined) => `⁨${s ?? '—'}⁩`;
const days = (d: number) => `${formatNumber(Math.max(1, Math.round(d)), 0)} روز`;

/** Plain dollar stablecoins: no swap is needed to be in dollars. */
const PLAIN_DOLLARS = new Set(['USDC', 'USDT', 'USDT0', 'USDC.E', 'DAI', 'USDS', 'PYUSD', 'RLUSD', 'USDG', 'FDUSD', 'AUSD']);
export const isPlainDollar = (symbol: string | null | undefined) => !!symbol && PLAIN_DOLLARS.has(symbol.toUpperCase());

const MERKL_APP = 'https://app.merkl.xyz/';

const swapStep = (symbol: string | null | undefined): Step[] => (isPlainDollar(symbol) ? [] : [{ kind: 'swap', short: 'سواپ', title: `تبدیل ${ltr(symbol)} به USDC` }]);

/** Merkl rewards counted in the estimate: claim them, then sell what is not already dollars. */
function rewardSteps(e: Estimate): Step[] {
  const merkl = e.rewardLines.filter((l) => l.source === 'merkl' && l.usd > 0);
  if (!merkl.length) return [];
  const tokens = [...new Set(merkl.map((l) => /پاداش\s+(\S+)/.exec(l.label)?.[1]).filter((t): t is string => !!t))];
  const sell = tokens.filter((t) => !isPlainDollar(t));
  return [
    { kind: 'claim', short: 'دریافت پاداش', title: `دریافت پاداش ${tokens.map(ltr).join('، ') || ''} در Merkl`, href: MERKL_APP },
    ...(sell.length ? [{ kind: 'sell' as const, short: 'فروش پاداش', title: `فروش ${sell.map(ltr).join('، ')} به USDC` }] : []),
  ];
}

export function stepsFor(o: Opportunity, e: Estimate): Step[] {
  const asset = o.assets.deposit[0]?.symbol ?? null;
  const name = ltr(o.protocol.name);
  const until = o.maturity ? ` تا ${formatDate(o.maturity)}` : '';
  const hold = e.earningDays > 0 ? e.earningDays : null;
  const x = e.leverage;
  switch (o.family) {
    case 'pt':
      return [
        { kind: 'buy', short: 'خرید PT', title: `خرید ${ltr(o.ptToken?.symbol ?? `PT-${asset ?? ''}`)} با USDC در ${name}`, href: o.url },
        { kind: 'wait', short: hold ? days(hold) : 'سررسید', title: `نگه‌داری${until}${hold ? ` (${days(hold)})` : ''}` },
        { kind: 'redeem', short: 'بازخرید', title: `بازخرید PT به ${ltr(asset)} در ${name}`, href: o.url },
        ...swapStep(asset),
      ];
    case 'yt':
      return [
        { kind: 'buy', short: 'خرید YT', title: `خرید YT ${ltr(asset)} با USDC در ${name}`, href: o.url },
        { kind: 'wait', short: hold ? days(hold) : 'سررسید', title: `نگه‌داری${until}${hold ? ` (${days(hold)})` : ''}؛ YT در سررسید صفر می‌شود` },
        { kind: 'claim', short: 'دریافت بازده', title: `دریافت بازده جمع‌شده (Claim) در ${name}`, href: o.url },
        ...swapStep(asset),
      ];
    case 'fixed-lend':
      return [
        { kind: 'buy', short: 'خرید واحد', title: `وام با نرخ ثابت: خرید واحد ${ltr(asset)} در ${name}`, href: o.url },
        { kind: 'wait', short: hold ? days(hold) : 'سررسید', title: `صبر${until}${hold ? ` (${days(hold)})` : ''}` },
        { kind: 'redeem', short: 'بازخرید', title: `بازخرید ۱ به ۱ ${ltr(asset)}`, href: o.url },
        ...swapStep(asset),
      ];
    case 'leverage': {
      const l = o.loop;
      const debt = l?.debt.token.symbol ?? o.assets.debt?.[0]?.symbol ?? null;
      const coll = l?.collateral.token.symbol ?? asset;
      const lev = x ? `${formatNumber(x.leverage, 1)}×` : 'اهرم سیاست';
      const health = x ? ` (سلامت ${formatNumber(x.health.value, 2)})` : '';
      if (o.maturity) {
        // PT loop: buy the PT, post it, borrow and buy more, close at maturity.
        return [
          { kind: 'buy', short: 'خرید PT', title: `خرید ${ltr(coll)} با USDC`, href: l?.entryUrl ?? null },
          { kind: 'collateral', short: 'وثیقه', title: `سپردن PT به‌عنوان وثیقه در ${name}`, href: o.url },
          { kind: 'loop', short: `لوپ ${lev}`, title: `وام ${ltr(debt)} و خرید PT بیشتر تا ${lev}${health}` },
          { kind: 'watch', short: hold ? days(hold) : 'سررسید', title: `نگه‌داری${until}${hold ? ` (${days(hold)})` : ''} و پایش سلامت` },
          { kind: 'repay', short: 'بستن', title: `سررسید: بازخرید PT، بازپرداخت ${ltr(debt)}، برداشت باقی‌مانده`, href: o.url },
          ...swapStep(debt),
        ];
      }
      return [
        { kind: 'collateral', short: 'وثیقه', title: `سپردن ${ltr(coll)} در ${name}`, href: o.url },
        { kind: 'loop', short: `لوپ ${lev}`, title: `وام ${ltr(debt)}، تبدیل به ${ltr(coll)} و سپردن دوباره تا ${lev}${health}` },
        { kind: 'watch', short: hold ? days(hold) : 'نگه‌داری', title: `${hold ? `${days(hold)} نگه‌داری` : 'نگه‌داری'} و پایش سلامت و نرخ وام` },
        { kind: 'repay', short: 'بستن', title: `بازپرداخت ${ltr(debt)} و برداشت ${ltr(coll)}`, href: o.url },
        ...swapStep(coll),
      ];
    }
    case 'vault':
      return [
        { kind: 'deposit', short: 'واریز', title: `واریز ${ltr(asset)} به خزانه‌ی ${ltr(o.market.name)}`, href: o.url },
        { kind: 'wait', short: hold ? days(hold) : 'نگه‌داری', title: `${hold ? `${days(hold)} نگه‌داری` : 'نگه‌داری'}؛ سود در قیمت سهم جمع می‌شود` },
        ...rewardSteps(e),
        { kind: 'withdraw', short: 'برداشت', title: `برداشت ${ltr(asset)} از خزانه`, href: o.url },
        ...swapStep(asset),
      ];
    case 'lend':
      return [
        { kind: 'deposit', short: 'واریز', title: `واریز ${ltr(asset)} در ${name}`, href: o.url },
        { kind: 'wait', short: hold ? days(hold) : 'نگه‌داری', title: `${hold ? `${days(hold)} نگه‌داری` : 'نگه‌داری'}؛ بهره هر لحظه جمع می‌شود` },
        ...rewardSteps(e),
        { kind: 'withdraw', short: 'برداشت', title: `برداشت ${ltr(asset)} با بهره`, href: o.url },
        ...swapStep(asset),
      ];
    default:
      // Opportunities known only through Merkl (staking, pools, other protocols).
      return [
        { kind: 'deposit', short: 'ورود', title: `ورود با ${ltr(asset)} در ${name}`, href: o.url },
        { kind: 'wait', short: hold ? days(hold) : 'نگه‌داری', title: hold ? `${days(hold)} نگه‌داری` : 'نگه‌داری' },
        ...rewardSteps(e),
        { kind: 'withdraw', short: 'خروج', title: `خروج و برداشت ${ltr(asset)}`, href: o.url },
        ...swapStep(asset),
      ];
  }
}

/** YT dollar ranking: buy, hold until the best day (or maturity), sell or claim, swap. */
export function ytLeaderSteps(p: { asset: string | null; protocol: string; url: string; days: number; toMaturity: boolean; maturity: string }): Step[] {
  return [
    { kind: 'buy', short: 'خرید YT', title: `خرید YT ${ltr(p.asset)} با USDC در ${ltr(p.protocol)}`, href: p.url },
    { kind: 'wait', short: days(p.days), title: p.toMaturity ? `نگه‌داری تا سررسید ${formatDate(p.maturity)} (${days(p.days)})` : `نگه‌داری ${days(p.days)}` },
    p.toMaturity
      ? { kind: 'claim', short: 'دریافت بازده', title: `دریافت بازده جمع‌شده؛ YT صفر می‌شود`, href: p.url }
      : { kind: 'sell', short: 'فروش YT', title: `فروش YT و دریافت بازده جمع‌شده`, href: p.url },
    ...swapStep(p.asset),
  ];
}

/** Loop PT dollar ranking: the same steps as a PT loop in the market analysis. */
export function loopLeaderSteps(p: { pt: string; ptUrl: string; lender: string; lenderUrl: string | null; debt: string; leverage: number; health: number | null; days: number; maturity: string }): Step[] {
  const lev = `${formatNumber(p.leverage, 1)}×`;
  return [
    { kind: 'buy', short: 'خرید PT', title: `خرید ${ltr(p.pt)} با USDC`, href: p.ptUrl },
    { kind: 'collateral', short: 'وثیقه', title: `سپردن PT به‌عنوان وثیقه در ${ltr(p.lender)}`, href: p.lenderUrl },
    { kind: 'loop', short: `لوپ ${lev}`, title: `وام ${ltr(p.debt)} و خرید PT بیشتر تا ${lev}${p.health ? ` (سلامت ${formatNumber(p.health, 2)})` : ''}` },
    { kind: 'watch', short: days(p.days), title: `نگه‌داری تا ${formatDate(p.maturity)} (${days(p.days)}) و پایش سلامت` },
    { kind: 'repay', short: 'بستن', title: `سررسید: بازخرید PT، بازپرداخت ${ltr(p.debt)}، برداشت`, href: p.lenderUrl },
    ...swapStep(p.debt),
  ];
}

/**
 * «وام با وثیقه»: post the holding, borrow dollars, (bridge,) run the dollar opportunity's
 * own steps, watch both liquidations, then close in reverse. Money figures are rounded
 * dollars; every step that has a page links to it.
 */
export function collateralSteps(p: {
  collateral: string;
  valueUsd: number;
  ltv: number;
  borrowUsd: number;
  loanSymbol: string;
  lender: string;
  lenderChain: string;
  lenderUrl: string | null;
  liquidationDrop: number;
  bridge: { from: string; to: string; usd: number } | null;
  /** The token the second leg is entered with, when it differs from the loan (a stable swap first). */
  swapTo: string | null;
  deploySteps: Step[];
  deployDrop: number | null;
}): Step[] {
  const $ = (x: number) => `${formatNumber(Math.round(x), 0)} دلار`;
  const pct = (x: number) => `${formatNumber(Math.round(x * 100), 0)}٪`;
  const watchDrop = Math.max(0, p.liquidationDrop / 2);
  const closeDeploy = p.deploySteps.filter((s) => s.kind !== 'wait' && s.kind !== 'watch');
  const enterDeploy = closeDeploy.filter((s) => s.kind === 'buy' || s.kind === 'deposit' || s.kind === 'collateral' || s.kind === 'loop');
  const exitDeploy = closeDeploy.filter((s) => !enterDeploy.includes(s));
  const hold = p.deploySteps.find((s) => s.kind === 'wait' || s.kind === 'watch');
  return [
    { kind: 'collateral', short: 'وثیقه', title: `سپردن ${$(p.valueUsd)} ${ltr(p.collateral)} به‌عنوان وثیقه در ${ltr(p.lender)} روی ${p.lenderChain}`, href: p.lenderUrl },
    { kind: 'repay', short: 'وام دلار', title: `وام ${$(p.borrowUsd)} ${ltr(p.loanSymbol)} (LTV ${pct(p.ltv)}) از همان بازار`, href: p.lenderUrl },
    ...(p.bridge ? [{ kind: 'swap' as const, short: 'پل', title: `پل ${ltr(p.loanSymbol)} از ${p.bridge.from} به ${p.bridge.to} (رفت‌وبرگشت حدود ${$(p.bridge.usd)})`, href: 'https://matcha.xyz' }] : []),
    ...(p.swapTo ? [{ kind: 'swap' as const, short: 'تبدیل', title: `تبدیل ${ltr(p.loanSymbol)} به ${ltr(p.swapTo)} (دو استیبل‌کوین؛ کارمزد کم، در حساب نیامده)`, href: 'https://matcha.xyz' }] : []),
    ...enterDeploy,
    {
      kind: 'watch',
      short: 'پایش',
      title: `${hold ? `${hold.title}؛ ` : ''}اگر ${ltr(p.collateral)} حدود ${pct(watchDrop)} افت کرد وثیقه اضافه کنید — با ${pct(p.liquidationDrop)} افت وام لیکویید می‌شود${p.deployDrop !== null ? `؛ لوپ با ${pct(p.deployDrop)} افت قیمت PT` : ''}`,
    },
    ...exitDeploy,
    ...(p.swapTo ? [{ kind: 'swap' as const, short: 'تبدیل', title: `تبدیل ${ltr(p.swapTo)} به ${ltr(p.loanSymbol)} برای بازپرداخت`, href: 'https://matcha.xyz' }] : []),
    ...(p.bridge ? [{ kind: 'swap' as const, short: 'پل برگشت', title: `پل ${ltr(p.loanSymbol)} به ${p.bridge.from}`, href: 'https://matcha.xyz' }] : []),
    { kind: 'withdraw', short: 'بستن وام', title: `بازپرداخت وام و بهره در ${ltr(p.lender)} و برداشت ${ltr(p.collateral)}`, href: p.lenderUrl },
  ];
}
