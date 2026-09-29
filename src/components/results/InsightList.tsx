import { BellRing, CheckCircle2, Info, OctagonAlert, TriangleAlert } from 'lucide-react';
import type { Insight, Severity, Verdict } from '../../lib/risk/advisor';
import { ALERT_METRICS, OPERATOR_LABELS, type TriggeredAlert } from '../../lib/risk/alerts';
import { formatNumber } from '../../lib/utils/formatting';
import { Num } from '../ui/num';

const look: Record<Severity, { icon: typeof Info; cls: string }> = {
  critical: { icon: OctagonAlert, cls: 'border-danger/40 bg-danger/10 text-danger' },
  warning: { icon: TriangleAlert, cls: 'border-warning/35 bg-warning/10 text-warning' },
  info: { icon: Info, cls: 'border-info/30 bg-info/10 text-info' },
  positive: { icon: CheckCircle2, cls: 'border-success/30 bg-success/10 text-success' },
};

const STRATEGY_FA = { pt: 'PT', yt: 'YT', loop: 'Loop', clmm: 'CLMM' } as const;

export function InsightRow({ insight, detailsHref }: { insight: Insight; detailsHref?: string }) {
  const { icon: Icon, cls } = look[insight.severity];
  return (
    <li className={`flex gap-3 border rounded-lg px-3 py-2.5 ${cls}`}>
      <Icon size={18} className="shrink-0 mt-0.5" aria-hidden />
      <div className="min-w-0 text-sm">
        <div className="font-semibold">
          {insight.title}
          {insight.strategy && <span className="font-normal text-secondary"> · استراتژی <bdi dir="ltr">{STRATEGY_FA[insight.strategy]}</bdi></span>}
        </div>
        <p className="text-secondary">
          {insight.detail}
          {insight.action && <span className="text-primary"> {insight.action}</span>}
        </p>
        {detailsHref && (
          <a href={detailsHref} className="tap inline-flex items-center text-accent underline underline-offset-4 text-sm min-h-8">
            جزئیات در «مقایسه»
          </a>
        )}
      </div>
    </li>
  );
}

/**
 * Warnings that matter for the decision: market-wide issues, those of the
 * recommended strategy, and the user's triggered alert rules.
 */
export function InsightList({
  insights,
  verdict,
  triggered,
  detailsHref,
}: {
  insights: Insight[];
  verdict: Verdict;
  triggered: TriggeredAlert[];
  /** Where the full explanation lives (e.g. "#details"). */
  detailsHref?: string;
}) {
  const shown = insights.filter(
    (i) => i.severity !== 'info' && (!i.strategy || i.strategy === verdict.best?.id || (!verdict.best && i.severity === 'critical')),
  );

  if (!shown.length && !triggered.length) {
    return (
      <div className="flex items-center gap-2 text-success text-sm border border-success/30 bg-success/10 rounded-lg px-3 py-2.5">
        <CheckCircle2 size={18} /> هشدار مهمی نیست.
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2">
      {triggered.map(({ rule, value }) => (
        <li key={rule.id} className="flex gap-3 border rounded-lg px-3 py-2.5 border-accent/40 bg-accent/10 text-accent">
          <BellRing size={18} className="shrink-0 mt-0.5" />
          <div className="text-sm">
            <span className="font-bold">هشدار شما: </span>
            <span className="text-secondary">
              {ALERT_METRICS[rule.metric].label} {OPERATOR_LABELS[rule.operator]}{' '}
              <Num>{formatNumber(rule.threshold, 2)}</Num> شد (اکنون <Num>{formatNumber(value, 2)}</Num>)
            </span>
          </div>
        </li>
      ))}
      {shown.map((i) => (
        <InsightRow key={i.id} insight={i} detailsHref={detailsHref} />
      ))}
    </ul>
  );
}
