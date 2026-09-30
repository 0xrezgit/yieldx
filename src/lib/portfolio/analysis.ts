import thresholds from '../../config/thresholds.json';
import type { Position } from '../../types/position';
import { ptPriceFromAPY } from '../calculators/implied-apy';
import { isStable, type OpportunityListing } from '../risk/opportunities';
import { formatNumber, formatPercent } from '../utils/formatting';
import { formatDollar } from './format';
import { mean } from '../utils/math';
import { EPS } from './ledger';
import { apyFromPT, type MarketQuote, type Quality, type Valuation } from './valuation';

/**
 * Hold-vs-exit reasoning for one real position. Every scenario starts from today's
 * valuation and states its assumptions; nothing here predicts a price or a date.
 */

export interface Scenario {
  label: string;
  /** Outcome in USD if the assumption holds (value received, after debt). */
  valueUsd: number;
  /** Outcome minus exiting now. */
  vsExitUsd: number;
  assumption: string;
}

export interface Trigger {
  /** What would make exiting more sensible, in plain Persian. */
  text: string;
}

export interface Alert {
  level: 'danger' | 'warning' | 'info' | 'success';
  text: string;
}

export interface Analysis {
  exitNow: { valueUsd: number; pnlUsd: number; quality: Quality };
  scenarios: Scenario[];
  triggers: Trigger[];
  /** Short verdict: leaning hold / exit / neutral, never a certainty. */
  lean: 'hold' | 'exit' | 'neutral' | 'unknown';
  summary: string[];
  assumptions: string[];
}

const growth = (apy: number, days: number) => Math.pow(1 + apy / 100, Math.max(0, days) / 365) - 1;
const annualize = (factor: number, days: number) => (factor > 0 && days > 0 ? (Math.pow(factor, 365 / days) - 1) * 100 : NaN);

/** Low / base / high base-APY from the protocol's history when it exists, else ±50% of today. */
export function apyRange(q: MarketQuote | null): { low: number; base: number; high: number; fromHistory: boolean } {
  const base = q?.baseAPY ?? NaN;
  const h = (q?.history ?? []).filter(Number.isFinite);
  if (h.length >= 14) {
    const sorted = [...h].sort((a, b) => a - b);
    const pick = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
    return { low: pick(0.2), base: mean(h.slice(-30)), high: pick(0.8), fromHistory: true };
  }
  return { low: base * 0.5, base, high: base * 1.5, fromHistory: false };
}

export function analyzePosition(p: Position, v: Valuation, q: MarketQuote | null): Analysis {
  const L = v.ledger;
  const A = v.assetUsd.value;
  const D = v.daysLeft;
  const exitNow = { valueUsd: v.exit.proceedsUsd, pnlUsd: v.exit.proceedsUsd - v.netValueUsd + v.pnlUsd, quality: v.exit.quality };
  const scenarios: Scenario[] = [];
  const triggers: Trigger[] = [];
  const summary: string[] = [];
  const assumptions: string[] = [];
  let lean: Analysis['lean'] = 'unknown';

  const s = (label: string, valueUsd: number, assumption: string) =>
    scenarios.push({ label, valueUsd, vsExitUsd: valueUsd - exitNow.valueUsd, assumption });

  if (v.status === 'closed') {
    return {
      exitNow,
      scenarios,
      triggers,
      lean: 'neutral',
      summary: [`این پوزیشن بسته شده است. سود و زیان نهایی ثبت‌شده: ${formatDollar(v.pnlUsd)}.`],
      assumptions,
    };
  }

  if (!Number.isFinite(A) || !Number.isFinite(v.markValueUsd)) {
    return {
      exitNow,
      scenarios,
      triggers,
      lean: 'unknown',
      summary: ['قیمت روز در دسترس نیست؛ تا وقتی قیمت بازار یا قیمت دستی ثبت نشود، نتیجه‌ی خروج و نگهداری قابل محاسبه نیست.'],
      assumptions,
    };
  }

  const exitLine = `خروج اکنون (تخمینی، پس از کارمزد و لغزش ${formatPercent(v.exit.costPct, 2)}${v.debtUsd.value > 0 ? ' و بازپرداخت بدهی' : ''}) حدود ${formatDollar(exitNow.valueUsd)} برمی‌گرداند؛ یعنی سود و زیان کل ${formatDollar(exitNow.pnlUsd)}.`;

  if (p.kind === 'pt' || p.kind === 'loop') {
    const units = L.units;
    if (v.matured) {
      summary.push('سررسید گذشته است؛ PT را می‌توانید بدون کارمزد معامله بازخرید کنید. پوزیشن تا ثبت بازخرید باز می‌ماند.');
      lean = 'exit';
    }
    const debtNow = v.debtUsd.value;
    const borrow = p.loop?.borrowAPY ?? 0;
    const debtAt = (apy: number) => debtNow * (1 + growth(apy, D));
    const holdAt = (priceMove: number, apy = borrow) => units * A * (1 + priceMove) - debtAt(apy);

    if (!v.matured) {
      s('نگهداری تا سررسید (قیمت دارایی ثابت)', holdAt(0), `هر PT در سررسید ۱ ${p.assetSymbol || 'واحد دارایی پایه'} بازخرید می‌شود.`);
      s('نگهداری تا سررسید، دارایی ۱۰٪ پایین‌تر', holdAt(-0.1), 'ارزش دلاری دارایی پایه ۱۰٪ کاهش یابد.');
      s('نگهداری تا سررسید، دارایی ۱۰٪ بالاتر', holdAt(0.1), 'ارزش دلاری دارایی پایه ۱۰٪ افزایش یابد.');
      if (p.kind === 'loop') {
        s('نگهداری، نرخ وام +۳ واحد درصد', holdAt(0, borrow + 3), `نرخ وام از ${formatPercent(borrow)} به ${formatPercent(borrow + 3)} برسد.`);
        s('نگهداری، نرخ وام +۶ واحد درصد', holdAt(0, borrow + 6), `نرخ وام به ${formatPercent(borrow + 6)} برسد.`);
      }

      // Yield still ahead if held: exit value vs redemption value, in asset terms, after debt.
      const exitAsset = exitNow.valueUsd / A;
      const holdAsset = units - debtAt(borrow) / A;
      const remaining = annualize(holdAsset / exitAsset, D);
      if (Number.isFinite(remaining)) {
        summary.push(
          `نگهداری تا سررسید (${formatNumber(D, 0)} روز دیگر) در مقایسه با خروج اکنون، بازده سالانه‌ی حدود ${formatPercent(remaining, 1)} برحسب ${p.assetSymbol || 'دارایی پایه'} دارد${p.kind === 'loop' ? ' (با نرخ وام فعلی)' : ''}.`,
        );
        triggers.push({
          text: `اگر جای دیگری با ریسک مشابه و برای همین مدت بیش از ${formatPercent(remaining, 1)} (پس از هزینه‌ی ورود و انتقال) بگیرید، خروج منطقی‌تر است.`,
        });
        lean = remaining < 0 ? 'exit' : 'hold';
      }
      if (q && Number.isFinite(q.impliedAPY)) {
        triggers.push({
          text: `هرچه Implied APY بازار پایین‌تر بیاید، قیمت PT بالاتر می‌رود و بخش بیشتری از سود ثابت را زودتر می‌گیرید؛ Implied فعلی ${formatPercent(q.impliedAPY, 2)} است.`,
        });
      }
      if (p.kind === 'loop' && debtNow > EPS) {
        // Borrow APY at which holding pays the same as exiting now.
        const room = units * A - exitNow.valueUsd;
        const be = room > 0 ? (Math.pow(room / debtNow, 365 / Math.max(1, D)) - 1) * 100 : NaN;
        if (Number.isFinite(be)) triggers.push({ text: `اگر نرخ وام به‌طور میانگین تا سررسید بالاتر از ${formatPercent(be, 1)} شود، نگهداری از خروج اکنون بدتر می‌شود.` });
        if (v.loop && Number.isFinite(v.loop.liquidationAPY)) {
          triggers.push({ text: `اگر Implied APY به حدود ${formatPercent(v.loop.liquidationAPY, 1)} برسد (با اوراکل قیمت بازار)، پوزیشن قابل لیکویید شدن است.` });
        }
      }
      assumptions.push('بازخرید در سررسید با نرخ ۱ PT = ۱ واحد دارایی پایه (قاعده‌ی بازار) و به قیمت دلاری فعلی دارایی.');
      if (p.kind === 'loop') assumptions.push(`بهره‌ی بدهی با نرخ ثبت‌شده‌ی ${formatPercent(borrow)} تا سررسید ادامه یابد؛ نرخ وام متغیر است.`);
    } else {
      s('بازخرید اکنون', units * A - debtNow, 'بازخرید ۱:۱ در سررسید، بدون کارمزد معامله.');
    }
  } else {
    // YT: holding earns the base yield until maturity, after which the token is worth 0.
    const units = L.units;
    const r = apyRange(q);
    const unclaimed = Number.isFinite(v.unclaimedYield.value) ? v.unclaimedYield.value : 0;
    const holdAt = (apy: number) => units * A * growth(apy, D) + unclaimed;
    if (v.matured) {
      summary.push('سررسید گذشته و YT دیگر ارزش فروش ندارد؛ فقط سود دریافت‌نشده باقی است که باید برداشت شود.');
      lean = 'exit';
    } else if (Number.isFinite(r.base)) {
      const src = r.fromHistory ? 'سابقه‌ی روزانه‌ی بازار' : 'سناریوی فرضی: نرخ فعلی ±۵۰٪ (سابقه‌ی کافی نیست؛ پیش‌بینی نیست)';
      s('نگهداری تا سررسید، بازده پایین', holdAt(r.low), `بازده پایه ${formatPercent(r.low, 1)} — ${src}`);
      s('نگهداری تا سررسید، بازده میانه', holdAt(r.base), `بازده پایه ${formatPercent(r.base, 1)} — ${src}`);
      s('نگهداری تا سررسید، بازده بالا', holdAt(r.high), `بازده پایه ${formatPercent(r.high, 1)} — ${src}`);

      // Base APY at which holding pays what selling now pays.
      const sale = exitNow.valueUsd - unclaimed;
      const g = units * A > 0 ? sale / (units * A) : NaN;
      const be = g > -1 ? (Math.pow(1 + g, 365 / Math.max(1, D)) - 1) * 100 : NaN;
      if (Number.isFinite(be)) {
        triggers.push({ text: `اگر انتظار دارید بازده پایه تا سررسید به‌طور میانگین کمتر از ${formatPercent(be, 1)} باشد، فروش اکنون بیشتر برمی‌گرداند.` });
        lean = r.base > be ? 'hold' : 'exit';
        summary.push(
          `بازار با قیمت فعلی YT، بازده پایه‌ی آینده را حدود ${formatPercent(be, 1)} قیمت‌گذاری کرده؛ میانه‌ی ${r.fromHistory ? 'سابقه' : 'فرض'} ${formatPercent(r.base, 1)} است.`,
        );
      }
      if (p.points.perDay > 0) {
        summary.push(`پوینت تخمینی تا امروز: ${formatNumber(v.points, 0)} — ارزش آن فقط در سناریوی جدا دیده می‌شود و وارد سود قطعی نمی‌شود.`);
      }
      assumptions.push('YT در سررسید ارزش صفر دارد؛ فقط سود دوره‌ی نگهداری برمی‌گردد.');
      if (!r.fromHistory) assumptions.push('بدون سابقه‌ی کافی، نرخ فعلی به کل دوره تعمیم داده نشده و بازه‌ی ±۵۰٪ یک سناریوی فرضی است، نه پیش‌بینی و نه احتمال.');
    }
  }

  summary.unshift(exitLine);
  if (v.exit.impactPct === null && v.exit.quality === 'estimate') assumptions.push('نقدینگی بازار نامعلوم است؛ لغزش قیمت فقط با کارمزد پایه لحاظ شده و مبلغ خروج ممکن است کمتر باشد.');
  if (v.exit.illiquid) summary.push('اندازه‌ی پوزیشن نسبت به نقدینگی بازار بزرگ است؛ خروج یکجا لغزش قیمت قابل‌توجهی دارد.');
  assumptions.push('مبلغ خروج تخمینی است؛ قیمت قابل اجرای فروش برای این اندازه از API دریافت نمی‌شود.');

  return { exitNow, scenarios, triggers, lean, summary, assumptions };
}

// ─── Targets and warnings ────────────────────────────────────────────────────

export function positionAlerts(p: Position, v: Valuation): Alert[] {
  const out: Alert[] = [];
  if (v.status === 'closed') return out;
  const t = p.targets;
  if (t.takeProfitPct !== null && v.pnlPct >= t.takeProfitPct) out.push({ level: 'success', text: `به هدف سود ${formatPercent(t.takeProfitPct, 1)} رسیده است (${formatPercent(v.pnlPct, 1, true)}).` });
  if (t.stopLossPct !== null && v.pnlPct <= -Math.abs(t.stopLossPct)) out.push({ level: 'danger', text: `زیان از سقف ${formatPercent(Math.abs(t.stopLossPct), 1)} گذشته است (${formatPercent(v.pnlPct, 1, true)}).` });
  if (v.loop) {
    const min = t.minHealth ?? thresholds.opportunities.loopMinHealth;
    if (v.loop.healthFactor < 1) out.push({ level: 'danger', text: 'شاخص سلامت زیر ۱ است؛ پوزیشن قابل لیکویید شدن است.' });
    else if (v.loop.healthFactor < min) out.push({ level: 'warning', text: `شاخص سلامت ${formatNumber(v.loop.healthFactor, 2)} زیر حداقل ${formatNumber(min, 2)} است.` });
  }
  if (v.status === 'matured') out.push({ level: 'warning', text: p.kind === 'yt' ? 'سررسید گذشته؛ سود دریافت‌نشده را برداشت و ثبت کنید.' : 'سررسید گذشته؛ بازخرید را انجام دهید و ثبت کنید.' });
  if (v.tokenPrice.quality === 'missing' || v.assetUsd.quality === 'missing') out.push({ level: 'warning', text: 'قیمت روز در دسترس نیست؛ قیمت را دستی وارد کنید.' });
  else if (v.tokenPrice.quality === 'stale') out.push({ level: 'info', text: 'داده‌ی بازار قدیمی است؛ تازه‌سازی کنید.' });
  if (v.ledger.missingRates > 0) out.push({ level: 'info', text: `${formatNumber(v.ledger.missingRates, 0)} رویداد نرخ دلاری یا نرخ دارایی ندارد؛ سود و زیان ناقص است.` });
  return out;
}

// ─── Moving to another market ────────────────────────────────────────────────

export interface SwitchSettings {
  /** Swap fee + slippage to enter the new market, %. */
  entryFeePct: number;
  /** Bridge / transfer cost when the chain changes, USD. */
  bridgeUsd: number;
  /** Advantage below this share of the position is treated as noise, %. */
  minAdvantagePct: number;
}

export const defaultSwitchSettings: SwitchSettings = { entryFeePct: thresholds.exit.costPercent, bridgeUsd: 10, minAdvantagePct: 0.5 };

export interface SwitchCandidate {
  m: OpportunityListing;
  /** Value at the comparison horizon if switching, USD. */
  switchUsd: number;
  stayUsd: number;
  advantageUsd: number;
  advantagePct: number;
  meaningful: boolean;
  risks: string[];
}

/**
 * Compares staying in a PT until its maturity with exiting now and buying another
 * PT, on the same horizon (today → this position's maturity). A candidate that
 * matures earlier is assumed to sit idle afterwards; one that matures later is
 * marked to its price at the horizon at its current implied APY and sold (fee paid).
 * Only same-class assets (stable vs non-stable) with enough liquidity are compared.
 */
export function compareMarkets(
  p: Position,
  v: Valuation,
  markets: OpportunityListing[],
  current: OpportunityListing | null,
  s: SwitchSettings = defaultSwitchSettings,
): SwitchCandidate[] {
  if (p.kind !== 'pt' || v.status !== 'open' || !(v.daysLeft >= 1)) return [];
  const A = v.assetUsd.value;
  const exitUsd = v.exit.proceedsUsd;
  if (!(A > 0) || !(exitUsd > 0)) return [];
  const H = v.daysLeft;
  const stayUsd = v.ledger.units * A;
  const stable = current ? isStable(current) : /usd|dai|eur/i.test(p.assetSymbol || p.marketName);
  const fee = s.entryFeePct / 100;

  const out: SwitchCandidate[] = [];
  for (const m of markets) {
    if (m.expired || m.id === p.marketId || !(m.impliedAPY > 0) || m.daysToMaturity < 7) continue;
    if (isStable(m) !== stable) continue;
    const liquidity = m.liquidity ?? 0;
    if (liquidity < exitUsd * 20) continue;

    const bridge = m.chain !== p.chain ? s.bridgeUsd : 0;
    const impact = Math.min(30, (exitUsd / liquidity) * 50) / 100;
    const invested = (exitUsd - bridge) * (1 - fee - impact);
    if (invested <= 0) continue;
    const pt0 = ptPriceFromAPY(m.impliedAPY, m.daysToMaturity);
    const faceUsd = invested / pt0; // USD face at maturity, same asset-price assumption as staying
    const switchUsd =
      m.daysToMaturity <= H ? faceUsd : faceUsd * ptPriceFromAPY(m.impliedAPY, m.daysToMaturity - H) * (1 - fee - impact);

    const risks: string[] = [];
    if (m.chain !== p.chain) risks.push(`شبکه‌ی دیگر (${m.chain})؛ هزینه و ریسک انتقال`);
    if (m.daysToMaturity > H + 30) risks.push('سررسید دیرتر؛ ارزش در افق مقایسه به نرخ بازار در آن زمان بستگی دارد');
    if (m.daysToMaturity < H - 7) risks.push('سررسید زودتر؛ پس از آن سرمایه بدون بازده فرض شده');
    if (m.impliedAPY >= thresholds.opportunities.ptHighRateWarn) risks.push('نرخ بسیار بالا؛ معمولاً نشانه‌ی ریسک دارایی');
    if (liquidity < thresholds.liquidity.thinUsd) risks.push('نقدینگی کم');
    if (!current || m.name !== current.name) risks.push('دارایی پایه‌ی متفاوت؛ ریسک دارایی جدا بررسی شود');

    const advantageUsd = switchUsd - stayUsd;
    const advantagePct = (advantageUsd / stayUsd) * 100;
    out.push({
      m,
      switchUsd,
      stayUsd,
      advantageUsd,
      advantagePct,
      meaningful: advantagePct >= s.minAdvantagePct && m.impliedAPY < thresholds.opportunities.ptHighRateWarn,
      risks,
    });
  }
  return out.sort((a, b) => b.advantageUsd - a.advantageUsd).slice(0, 5);
}

/** Days are fractional; this is how the UI prints them. */
export const fmtDays = (d: number) => (d >= 1 ? `${formatNumber(Math.floor(d), 0)} روز` : d > 0 ? `${formatNumber(Math.max(1, Math.round(d * 24)), 0)} ساعت` : 'سررسید شده');

export { apyFromPT };
