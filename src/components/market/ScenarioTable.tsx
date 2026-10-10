import { Num } from '../ui/num';
import { formatPercent, formatUSD } from '../../lib/utils/formatting';
import { signedPct } from '../opportunities/parts';

export interface ScenarioInput {
  kind: 'low' | 'likely' | 'high';
  /** Base yield over the hold, % a year. */
  basePct: number;
  /** What comes back (yield, plus a sale before maturity), USD; null when unknown. */
  received: number | null;
  /** Cash result, USD; null when unknown. */
  cash: number | null;
  /** USD of yield exposure (what points are counted on); null when unknown. */
  notional: number | null;
}

const LABEL: Record<ScenarioInput['kind'], string> = { low: 'بدبینانه', likely: 'محتمل', high: 'خوش‌بینانه' };

/**
 * The points' assumed value, as a yearly % of the yield exposure — one per row, the way
 * Exponent's own simulation pairs them. An assumption only: the cash column never has it.
 */
export const POINTS_APY: Record<ScenarioInput['kind'], number> = { low: 0, likely: 10, high: 20 };

const usd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2, true);
const tone = (x: number | null) => (x === null ? '' : x >= 0 ? 'text-success' : 'text-danger');

/**
 * «شبیه‌سازی»: the same position under the low / likely / high base yield. The cash
 * columns are what the position pays; with points, two more columns add an assumed
 * points value (`POINTS_APY`) — labelled as such, never mixed into the cash result.
 */
export function ScenarioTable({ rows, capital, days, points }: { rows: ScenarioInput[]; capital: number; days: number; points: boolean }) {
  if (!rows.length) return null;
  const withPoints = (r: ScenarioInput) => (r.cash === null || r.notional === null ? null : r.cash + (r.notional * POINTS_APY[r.kind] * days) / 36_500);
  return (
    <section className="flex flex-col gap-2" aria-label="شبیه‌سازی">
      <h3 className="text-sm font-semibold text-primary">شبیه‌سازی با بازده پایه‌ی متغیر</h3>
      <div className="overflow-x-auto rounded-lg border border-default">
        <table className="w-full text-sm">
          <thead className="bg-canvas text-xs text-muted">
            <tr>
              <th className="py-2 px-3 text-right font-medium">حالت</th>
              <th className="py-2 px-3 text-right font-medium">بازده پایه</th>
              <th className="py-2 px-3 text-right font-medium">دریافتی</th>
              <th className="py-2 px-3 text-right font-medium">نتیجه‌ی نقدی</th>
              {points && <th className="py-2 px-3 text-right font-medium">ارزش فرضی پوینت</th>}
              {points && <th className="py-2 px-3 text-right font-medium">با پوینت</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-default">
            {rows.map((r) => {
              const p = withPoints(r);
              return (
                <tr key={r.kind} className={r.kind === 'likely' ? 'bg-brand/[0.06]' : ''}>
                  <td className="py-2 px-3 whitespace-nowrap">
                    <span className={r.kind === 'likely' ? 'font-semibold text-primary' : 'text-secondary'}>{LABEL[r.kind]}</span>
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap"><Num>{formatPercent(r.basePct, 2)}</Num></td>
                  <td className="py-2 px-3 whitespace-nowrap">{r.received === null ? '—' : <Num>{usd(r.received)}</Num>}</td>
                  <td className={`py-2 px-3 whitespace-nowrap font-medium ${tone(r.cash)}`}>
                    {r.cash === null ? '—' : <><Num>{usd(r.cash)}</Num> <span className="text-xs opacity-80">(<Num>{signedPct((r.cash / capital) * 100, 1)}</Num>)</span></>}
                  </td>
                  {points && <td className="py-2 px-3 whitespace-nowrap text-secondary"><Num>{formatPercent(POINTS_APY[r.kind], 0)}</Num> سالانه</td>}
                  {points && (
                    <td className={`py-2 px-3 whitespace-nowrap ${tone(p)}`}>
                      {p === null ? '—' : <><Num>{usd(p)}</Num> <span className="text-xs opacity-80">(<Num>{signedPct((p / capital) * 100, 1)}</Num>)</span></>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted leading-relaxed">
        بازده پایه ثابت فرض نشده: «محتمل» یعنی نرخ امروز که در طول دوره به سطح ماه اخیر همین بازار نزدیک می‌شود (رتبه با همین است)؛ «بدبینانه» کمترین نرخ اخیر بازار است.
        {points && ' ارزش پوینت فقط فرض است و در نتیجه‌ی نقدی نیامده؛ ستون «با پوینت» یعنی اگر پوینت‌ها سالانه همان درصدِ اکسپوژر بیرزند.'}
      </p>
    </section>
  );
}
