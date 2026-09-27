'use client';

import { useState } from 'react';
import { Bell, Plus, Trash2 } from 'lucide-react';
import { Badge } from '../ui/badge';
import { Num } from '../ui/num';
import { NumberField, SelectField } from '../ui/field';
import type { useAlerts } from '../../hooks/useAlerts';
import type { Analysis } from '../../lib/analysis';
import {
  ALERT_METRICS,
  OPERATOR_LABELS,
  metricValue,
  type AlertMetric,
  type AlertOperator,
  type AlertRule,
} from '../../lib/risk/alerts';
import { formatNumber } from '../../lib/utils/formatting';

const metricOptions = (Object.keys(ALERT_METRICS) as AlertMetric[]).map((m) => ({
  value: m,
  label: ALERT_METRICS[m].label,
}));
const operatorOptions = (Object.keys(OPERATOR_LABELS) as AlertOperator[]).map((o) => ({
  value: o,
  label: OPERATOR_LABELS[o],
}));

type Alerts = ReturnType<typeof useAlerts>;

/** Custom alert rules — checked on every change; hits appear in the warnings list. */
export function AlertRules({ analysis, alerts }: { analysis: Analysis; alerts: Alerts }) {
  const [metric, setMetric] = useState<AlertMetric>('impliedAPY');
  const [operator, setOperator] = useState<AlertOperator>('gt');
  const [threshold, setThreshold] = useState(15);

  const status = (r: AlertRule) => {
    const v = metricValue(r.metric, analysis);
    const hit = v !== null && !Number.isNaN(v) && (r.operator === 'gt' ? v > r.threshold : v < r.threshold);
    return { v, hit };
  };

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2">
        {alerts.rules.length === 0 && <li className="text-sm text-muted">هنوز هشداری نساخته‌اید.</li>}
        {alerts.rules.map((r) => {
          const { v, hit } = status(r);
          const on = r.enabled && hit;
          return (
            <li
              key={r.id}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 text-sm ${
                on ? 'border-accent/50 bg-accent/10' : 'border-default bg-elevated/40'
              }`}
            >
              <input
                type="checkbox"
                checked={r.enabled}
                aria-label="فعال"
                onChange={(e) => alerts.update({ ...r, enabled: e.target.checked })}
                className="accent-accent size-4"
              />
              <div className={`flex-1 min-w-0 ${r.enabled ? 'text-primary' : 'text-muted line-through'}`}>
                {ALERT_METRICS[r.metric].label} {OPERATOR_LABELS[r.operator]} <Num>{formatNumber(r.threshold, 2)}</Num>
                <div className="text-xs text-muted">
                  اکنون <Num>{v === null ? '—' : formatNumber(v, 2)}</Num>
                </div>
              </div>
              {on && (
                <Badge tone="accent">
                  <Bell size={11} /> فعال شد
                </Badge>
              )}
              <button
                type="button"
                onClick={() => alerts.remove(r.id)}
                aria-label="حذف"
                className="p-1.5 text-muted hover:text-danger transition-colors"
              >
                <Trash2 size={16} />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="grid grid-cols-2 sm:grid-cols-[minmax(0,1fr)_8rem_7rem_auto] gap-2 items-end">
        <div className="col-span-2 sm:col-span-1">
          <SelectField<AlertMetric> label="شاخص" value={metric} onChange={setMetric} options={metricOptions} />
        </div>
        <SelectField<AlertOperator> label="شرط" value={operator} onChange={setOperator} options={operatorOptions} />
        <NumberField label="مقدار" value={threshold} onChange={setThreshold} />
        <button
          type="button"
          onClick={() => alerts.add({ metric, operator, threshold, enabled: true })}
          className="col-span-2 sm:col-span-1 flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 font-medium text-white brand-gradient"
        >
          <Plus size={16} /> افزودن
        </button>
      </div>
    </div>
  );
}
