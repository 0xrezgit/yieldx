import { Newspaper } from 'lucide-react';
import type { Analysis } from '../../lib/analysis';
import type { ScenarioParams } from '../../types/scenario';
import { buildMarketBrief, type BriefTone } from '../../lib/risk/market-brief';
import { Card } from '../ui/card';
import { Badge } from '../ui/badge';

const dot: Record<BriefTone, string> = {
  neutral: 'bg-secondary',
  good: 'bg-success',
  warn: 'bg-warning',
  bad: 'bg-danger',
};

const pointsBadge = {
  active: <Badge tone="success">پوینت دارد</Badge>,
  none: <Badge tone="danger">بدون پوینت</Badge>,
  unknown: <Badge tone="muted">پوینت نامشخص</Badge>,
} as const;

/** "About this market" — protocol, rates, points program and airdrop caveats in plain words. */
export function MarketBrief({ p, a }: { p: ScenarioParams; a: Analysis }) {
  return (
    <Card title="درباره‌ی این بازار" icon={<Newspaper size={18} />} actions={pointsBadge[p.pointsStatus]}>
      <ul className="flex flex-col gap-3">
        {buildMarketBrief(p, a).map((l) => (
          <li key={l.label} className="flex gap-3 text-sm">
            <span className={`mt-2 size-2 rounded-full shrink-0 ${dot[l.tone]}`} />
            <div className="min-w-0">
              <span className="font-bold text-primary">{l.label}: </span>
              <span className="text-secondary">{l.text}</span>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
