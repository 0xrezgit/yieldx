import { CheckCircle2, OctagonAlert, TriangleAlert } from 'lucide-react';
import type { Verdict } from '../../lib/risk/advisor';
import { formatPercent, formatUSD } from '../../lib/utils/formatting';
import { Num } from '../ui/num';

const style = {
  go: { ring: 'from-success/60 to-brand2/40', text: 'text-success', icon: CheckCircle2, label: 'پیشنهاد' },
  caution: { ring: 'from-warning/60 to-accent/40', text: 'text-warning', icon: TriangleAlert, label: 'پیشنهاد با احتیاط' },
  stop: { ring: 'from-danger/60 to-accent/30', text: 'text-danger', icon: OctagonAlert, label: 'توجه' },
} as const;

/** The one thing to read first: what to do and what it may earn. */
export function VerdictHero({ verdict, compact = false }: { verdict: Verdict; compact?: boolean }) {
  const s = style[verdict.level];
  const Icon = s.icon;
  const best = verdict.best;
  return (
    <section className={`rounded-2xl p-px bg-linear-to-bl ${s.ring}`}>
      <div className={`rounded-2xl bg-surface ${compact ? 'p-4' : 'p-5 md:p-6'} flex items-center gap-4`}>
        <div className={`shrink-0 rounded-2xl bg-elevated p-3 ${s.text}`}>
          <Icon size={compact ? 26 : 32} />
        </div>
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-medium ${s.text}`}>{s.label}</div>
          <div className={`${compact ? 'text-xl' : 'text-2xl md:text-3xl'} font-extrabold text-primary leading-tight`}>
            {verdict.title}
          </div>
          {!best && <p className="text-secondary text-sm mt-1">{verdict.summary}</p>}
        </div>
        {best && (
          <div className="text-left shrink-0">
            <div className={`${compact ? 'text-xl' : 'text-2xl md:text-3xl'} font-extrabold ${best.pnl >= 0 ? 'text-success' : 'text-danger'}`}>
              <Num>{formatUSD(best.pnl, 0)}</Num>
            </div>
            <div className="text-sm text-secondary">
              <Num>{formatPercent(best.roi, 1, true)}</Num> تا سررسید
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
