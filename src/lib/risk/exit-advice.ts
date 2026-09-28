import thresholds from '../../config/thresholds.json';
import type { Analysis } from '../analysis';
import type { ScenarioParams } from '../../types/scenario';
import type { ExitPoint } from '../calculators/exit-plan';
import { DAY_MS } from '../utils/math';
import { formatCompact, formatDate, formatNumber, formatPercent, formatUSD } from '../utils/formatting';

export type StepTone = 'primary' | 'trigger' | 'positive' | 'warning' | 'info';

export interface ExitStep {
  tone: StepTone;
  title: string;
  text: string;
}

export const dayToDate = (day: number, now = Date.now()) => formatDate(new Date(now + day * DAY_MS).toISOString());

const money = (x: number) => (x >= 0 ? `+${formatUSD(x, 0)}` : formatUSD(x, 0));

function triggerText(x: ExitPoint): string {
  if (x.breakEvenPrice <= 0) return 'بازده جمع‌شده سرمایه را برگردانده؛ فروش در هر قیمتی سود است.';
  const rate = Number.isFinite(x.breakEvenImpliedAPY) ? ` (نرخ بازار حدود ${formatPercent(x.breakEvenImpliedAPY, 1)})` : '';
  return `قیمت YT ${formatNumber(x.breakEvenPrice, 4)}${rate}`;
}

/** Plain-Persian YT exit plan, most important step first. */
export function buildExitSteps(p: ScenarioParams, a: Analysis, now = Date.now()): ExitStep[] {
  const plan = a.exit;
  if (!plan) return [];
  const steps: ExitStep[] = [];
  const rec = plan.recommended;
  const snapshotPassed = a.snapshotDays === 0;

  const ytShare = a.liquidity.ytShareOfMarket;
  if (ytShare !== null && ytShare > thresholds.liquidity.ytShareCritical) {
    steps.push({
      tone: 'warning',
      title: 'اول سرمایه را کم کنید',
      text: 'این حجم YT از اندازه‌ی بازار بزرگ‌تر است؛ اعداد زیر فقط با قیمت فعلی درست‌اند.',
    });
  }

  if (snapshotPassed) {
    steps.push({ tone: 'warning', title: 'اسنپ‌شات گذشته', text: 'پوینت‌های جدید برای این فصل حساب نمی‌شوند.' });
  }

  if (!plan.earnsPoints) {
    const best = plan.bestCash;
    steps.push(
      best.cash >= 0 && best.day > 0
        ? {
            tone: 'primary',
            title: `نگه داشتن تا ${dayToDate(best.day, now)}`,
            text: `بدون پوینت هم نتیجه‌ی نقدی حدود ${money(best.cash)} است.`,
          }
        : {
            tone: 'warning',
            title: 'خرید YT به‌صرفه نیست',
            text: 'این موقعیت پوینت نمی‌گیرد و با نرخ فعلی بازده، هزینه‌ی YT را جبران نمی‌کند.',
          },
    );
    return steps;
  }

  if (rec.day === 0) {
    steps.push({
      tone: 'warning',
      title: 'با این سقف ضرر وارد نشوید',
      text: `حتی نگه داشتن کوتاه هم بیش از ${formatUSD(plan.lossBudget, 0)} ضرر نقدی دارد. سقف ضرر را بالا ببرید یا منتظر YT ارزان‌تر بمانید.`,
    });
  } else {
    const atSnapshot = a.snapshotDays !== null && rec.day === plan.horizon;
    steps.push({
      tone: 'primary',
      title: `تا ${dayToDate(rec.day, now)} نگه دارید و بفروشید`,
      text:
        `${formatNumber(rec.day, 0)} روز، حدود ${formatCompact(rec.points)} پوینت. ` +
        `نتیجه‌ی نقدی ${money(rec.cash)}` +
        (rec.cash < 0 ? ` (سقف ضرر شما ${formatUSD(plan.lossBudget, 0)}).` : '.') +
        (atSnapshot ? ' بعد از اسنپ‌شات پوینت ارزشی ندارد.' : ''),
    });
  }

  steps.push({
    tone: 'trigger',
    title: 'فروش زودتر بدون ضرر',
    text: `اگر امروز به ${triggerText(plan.sellTriggerToday)} رسید، بفروشید؛ پوینت‌های جمع‌شده برای شما می‌ماند.`,
  });

  if (plan.cashBreakEven && plan.cashBreakEven.day <= plan.horizon) {
    steps.push({
      tone: 'positive',
      title: `از ${dayToDate(plan.cashBreakEven.day, now)} در سود نقدی هستید`,
      text: 'حتی بدون ایردراپ، اگر نرخ بازار ثابت بماند.',
    });
  }

  // Airdrop upside only makes sense when the points-supply assumption is plausible.
  const plausible = p.totalPointsSupply > 0 && a.yt.points / p.totalPointsSupply <= thresholds.points.maxPlausibleShare;
  const bt = plan.bestTotal;
  if (plausible && bt.day > rec.day && bt.total > 0) {
    steps.push({
      tone: 'info',
      title: 'اگر به ایردراپ مطمئنید',
      text: `نگه داشتن تا ${dayToDate(bt.day, now)} با احتساب ایردراپ ${money(bt.total)} می‌دهد، ولی ضرر نقدی تا ${formatUSD(bt.cash, 0)} می‌رسد.`,
    });
  }

  return steps;
}
