import type { Analysis } from '../analysis';

export type AlertMetric =
  | 'impliedAPY'
  | 'gapPercent'
  | 'healthFactor'
  | 'costPerMillion'
  | 'ytROI'
  | 'apyTrend7d'
  | 'clmmEdgeDistance'
  | 'daysToMaturity';

export type AlertOperator = 'gt' | 'lt';

export interface AlertRule {
  id: string;
  metric: AlertMetric;
  operator: AlertOperator;
  threshold: number;
  enabled: boolean;
}

export const ALERT_METRICS: Record<AlertMetric, { label: string; unit: string }> = {
  impliedAPY: { label: 'Implied APY', unit: '٪' },
  gapPercent: { label: 'شکاف نسبی Implied/پایه', unit: '٪' },
  healthFactor: { label: 'فاکتور سلامت لوپ', unit: '' },
  costPerMillion: { label: 'هزینه‌ی هر ۱M پوینت', unit: '$' },
  ytROI: { label: 'بازده خالص YT', unit: '٪' },
  apyTrend7d: { label: 'شیب ۷ روزه‌ی APY', unit: 'واحد درصد/روز' },
  clmmEdgeDistance: { label: 'فاصله تا لبه‌ی بازه‌ی CLMM', unit: '٪' },
  daysToMaturity: { label: 'روز تا سررسید', unit: 'روز' },
};

export const OPERATOR_LABELS: Record<AlertOperator, string> = { gt: 'بیشتر از', lt: 'کمتر از' };

export function metricValue(metric: AlertMetric, a: Analysis): number | null {
  switch (metric) {
    case 'impliedAPY':
      return a.implied.impliedAPY;
    case 'gapPercent':
      return a.implied.gapPercent;
    case 'healthFactor':
      return a.looping.liquidation.healthFactor;
    case 'costPerMillion':
      return a.yt.valuation.costPerMillion;
    case 'ytROI':
      return a.yt.roi;
    case 'apyTrend7d':
      return a.trend ? a.trend.trend7d : null;
    case 'clmmEdgeDistance':
      return a.clmm.distanceToEdge * 100;
    case 'daysToMaturity':
      return a.days;
  }
}

export interface TriggeredAlert {
  rule: AlertRule;
  value: number;
}

/** Returns the enabled rules whose condition currently holds. Metrics without data never fire. */
export function evaluateAlerts(rules: AlertRule[], a: Analysis): TriggeredAlert[] {
  const out: TriggeredAlert[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const value = metricValue(rule.metric, a);
    if (value === null || Number.isNaN(value)) continue;
    const hit = rule.operator === 'gt' ? value > rule.threshold : value < rule.threshold;
    if (hit) out.push({ rule, value });
  }
  return out;
}

export function isAlertRule(x: unknown): x is AlertRule {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return (
    typeof r.id === 'string' &&
    typeof r.metric === 'string' &&
    r.metric in ALERT_METRICS &&
    (r.operator === 'gt' || r.operator === 'lt') &&
    typeof r.threshold === 'number' &&
    Number.isFinite(r.threshold) &&
    typeof r.enabled === 'boolean'
  );
}
