import thresholds from '../../config/thresholds.json';
import type { Analysis, StrategyId, StrategySummary } from '../analysis';
import type { ScenarioParams } from '../../types/scenario';
import { formatNumber, formatPercent, formatUSD, formatUSDCompact } from '../utils/formatting';

export type Severity = 'critical' | 'warning' | 'info' | 'positive';

export interface Insight {
  id: string;
  severity: Severity;
  /** Strategy the insight is about; undefined for market-wide insights. */
  strategy?: StrategyId;
  title: string;
  detail: string;
  action?: string;
}

export interface Verdict {
  level: 'go' | 'caution' | 'stop';
  title: string;
  summary: string;
  /** Recommended strategy: best risk-adjusted PnL without a critical issue. */
  best: StrategySummary | null;
}

const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2, positive: 3 };

/** Turns an analysis into short, prioritised Persian guidance. */
export function buildInsights(p: ScenarioParams, a: Analysis): Insight[] {
  const out: Insight[] = [];
  const push = (i: Insight) => out.push(i);

  const errors = a.validation.issues.filter((i) => i.level === 'error');
  if (errors.length) {
    push({
      id: 'invalid-input',
      severity: 'critical',
      title: 'ورودی‌ها را اصلاح کنید',
      detail: errors.map((e) => e.message).join(' '),
    });
    return out;
  }

  // YT: price vs current yield
  const { implied } = a;
  if (implied.status === 'danger') {
    push({
      id: 'gap',
      strategy: 'yt',
      severity: implied.gapPercent >= thresholds.gap.dangerPercent ? 'critical' : 'warning',
      title: implied.gapPercent >= thresholds.gap.dangerPercent ? 'YT گران است' : 'YT کمی گران است',
      detail: `بازار ${formatPercent(implied.impliedAPY)} می‌خواهد، بازده فعلی ${formatPercent(p.baseAPY)} است.`,
      action: 'فقط اگر به ایردراپ مطمئنید YT بخرید.',
    });
  } else if (implied.status === 'safe') {
    push({
      id: 'gap',
      strategy: 'yt',
      severity: 'positive',
      title: 'YT ارزان است',
      detail: `بازده فعلی (${formatPercent(p.baseAPY)}) از نرخ بازار (${formatPercent(implied.impliedAPY)}) بیشتر است.`,
    });
  }

  // YT: points
  const v = a.yt.valuation;
  if (v.recommendation === 'avoid') {
    push({
      id: 'points',
      strategy: 'yt',
      severity: 'critical',
      title: 'پوینت‌ها ارزش هزینه را ندارند',
      detail: `هر ۱M پوینت ${formatUSD(v.costPerMillion)} هزینه و ${formatUSD(v.valuePerMillion)} ارزش دارد.`,
      action: 'حجم YT را کم کنید یا صبر کنید.',
    });
  } else if (v.recommendation === 'wait') {
    push({
      id: 'points',
      strategy: 'yt',
      severity: 'warning',
      title: 'حاشیه‌ی سود پوینت کم است',
      detail: `با FDV کمتر از ${formatUSDCompact(v.breakEvenFDV)} زیان می‌کنید.`,
    });
  } else if (v.burn > 0) {
    push({
      id: 'points',
      strategy: 'yt',
      severity: 'positive',
      title: 'قیمت پوینت منطقی است',
      detail: `هزینه‌ی هر ۱M پوینت ${formatUSD(v.costPerMillion)}، ارزش آن ${formatUSD(v.valuePerMillion)}.`,
    });
  }

  // YT: APY trend and downside
  const tr = a.trend;
  if (tr?.risk === 'high') {
    push({
      id: 'trend',
      strategy: 'yt',
      severity: 'warning',
      title: tr.volatility > thresholds.trend.volatilityHigh ? 'نوسان APY زیاد است' : 'APY در حال افت است',
      detail: `پیش‌بینی هفته‌ی بعد: ${formatPercent(tr.predictedNextWeek)}.`,
    });
  }

  const bear = a.scenarios.scenarios.bear;
  if (bear.pnlWithAirdrop < 0 && a.scenarios.scenarios.base.pnlWithAirdrop > 0) {
    push({
      id: 'bear-case',
      strategy: 'yt',
      severity: 'warning',
      title: 'در حالت بد، YT زیان می‌دهد',
      detail: `با APY ${formatPercent(bear.apy)}: ${formatUSD(bear.pnlWithAirdrop)}.`,
    });
  }

  // Looping
  const loop = a.looping;
  if (p.loops > 0) {
    if (p.borrowAPY >= loop.breakEvenBorrowAPY) {
      push({
        id: 'loop-negative',
        strategy: 'loop',
        severity: 'critical',
        title: 'لوپ زیان‌ده است',
        detail: `نرخ وام از ${formatPercent(loop.breakEvenBorrowAPY)} بیشتر است.`,
        action: 'حلقه‌ها را کم کنید یا وام ارزان‌تر بگیرید.',
      });
    }
    if (loop.liquidation.risk !== 'low') {
      push({
        id: 'liquidation',
        strategy: 'loop',
        severity: loop.liquidation.risk === 'high' ? 'critical' : 'warning',
        title: loop.liquidation.risk === 'high' ? 'خطر لیکوئید شدن' : 'فاصله تا لیکوئید کم است',
        detail: `اگر Implied APY به ${formatPercent(loop.liquidation.liquidationImpliedAPY, 1)} برسد لیکوئید می‌شوید.`,
        action: loop.liquidation.risk === 'high' ? 'حلقه یا LTV را کم کنید.' : undefined,
      });
    }
  }

  // CLMM
  const c = a.clmm;
  if (!c.inRange) {
    push({
      id: 'clmm-range',
      strategy: 'clmm',
      severity: 'critical',
      title: 'بازه‌ی CLMM فعال نیست',
      detail: `نرخ فعلی ${formatPercent(implied.impliedAPY)} بیرون از بازه‌ی ${formatPercent(p.rangeLowerAPY)} تا ${formatPercent(p.rangeUpperAPY)} است.`,
      action: 'بازه را جابه‌جا کنید.',
    });
  } else if (c.risk === 'high') {
    push({
      id: 'clmm-range',
      strategy: 'clmm',
      severity: 'warning',
      title: 'نزدیک لبه‌ی بازه‌ی CLMM',
      detail: 'بازه را گسترده‌تر کنید.',
    });
  }

  // Market-wide
  if (a.liquidity.positionShare !== null && a.liquidity.positionShare > thresholds.liquidity.positionShareWarning) {
    push({
      id: 'liquidity',
      severity: 'warning',
      title: 'سرمایه نسبت به نقدینگی بازار زیاد است',
      detail: 'اسلیپیج قیمت را بدتر می‌کند؛ پله‌ای وارد شوید.',
    });
  }

  if (a.days <= 14) {
    push({
      id: 'maturity',
      severity: 'warning',
      title: 'سررسید نزدیک است',
      detail: `${formatNumber(a.days, 0)} روز مانده؛ فرصت جمع کردن پوینت کم است.`,
    });
  }

  return out.sort((x, y) => order[x.severity] - order[y.severity]);
}

/**
 * Verdict = recommended strategy (best risk-adjusted PnL with no critical issue)
 * plus an overall level driven by market-wide issues and that strategy's issues.
 */
export function buildVerdict(a: Analysis, insights: Insight[]): Verdict {
  if (!a.validation.valid) {
    return { level: 'stop', title: 'ورودی‌ها ناقص است', summary: 'مقادیر قرمز را اصلاح کنید.', best: null };
  }

  const criticalFor = (id: StrategyId) => insights.some((i) => i.strategy === id && i.severity === 'critical');
  const best = a.ranked.find((s) => s.pnl > 0 && !criticalFor(s.id)) ?? null;

  if (!best) {
    return {
      level: 'stop',
      title: 'فعلاً دست نگه دارید',
      summary: 'با این فرض‌ها هیچ استراتژی‌ای سود امنی ندارد.',
      best: null,
    };
  }

  const relevant = insights.filter((i) => !i.strategy || i.strategy === best.id);
  const summary = `سود تخمینی تا سررسید ${formatUSD(best.pnl)} (${formatPercent(best.roi, 1, true)}).`;

  if (relevant.some((i) => i.severity === 'critical')) {
    return { level: 'stop', title: `${best.name}، ولی با هشدار جدی`, summary, best };
  }
  if (relevant.some((i) => i.severity === 'warning') || best.risk === 'high') {
    return { level: 'caution', title: `${best.name}، با احتیاط`, summary, best };
  }
  return { level: 'go', title: best.name, summary, best };
}
