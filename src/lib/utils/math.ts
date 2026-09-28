export const DAY_MS = 86_400_000;

export const finite = (x: number, fallback = 0) => (Number.isFinite(x) ? x : fallback);

export const clamp = (x: number, min: number, max: number) => Math.min(max, Math.max(min, x));

/** Whole days from now until an ISO date (minimum 1 so annualisation never divides by zero). */
export function daysUntil(isoDate: string, now = Date.now()): number {
  const t = new Date(isoDate).getTime();
  if (!Number.isFinite(t)) return 1;
  return Math.max(1, Math.ceil((t - now) / DAY_MS));
}

export function mean(values: number[]): number {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/** Population standard deviation. */
export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/** Least-squares slope of values against their index (units per step). */
export function linearSlope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xMean = (n - 1) / 2;
  const yMean = mean(values);
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xMean) * (values[i] - yMean);
    den += (i - xMean) ** 2;
  }
  return den === 0 ? 0 : num / den;
}
