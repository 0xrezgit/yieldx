import thresholds from '../../config/thresholds.json';
import type { ScenarioParams } from '../../types/scenario';
import { daysUntil } from './math';

export interface ValidationIssue {
  field: keyof ScenarioParams | 'general';
  level: 'error' | 'warning';
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

const result = (issues: ValidationIssue[]): ValidationResult => ({
  valid: !issues.some((i) => i.level === 'error'),
  issues,
});

/** Minimal checks shared by every protocol adapter. */
export function validatePosition(p: {
  capital: number;
  underlyingPrice: number;
  ptPrice: number;
  ytPrice: number;
  daysToMaturity: number;
}): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!(p.capital > 0)) issues.push({ field: 'capital', level: 'error', message: 'سرمایه باید بیشتر از صفر باشد.' });
  if (!(p.underlyingPrice > 0))
    issues.push({ field: 'underlyingPrice', level: 'error', message: 'قیمت دارایی پایه باید بیشتر از صفر باشد.' });
  if (!(p.ptPrice > 0 && p.ptPrice < 1))
    issues.push({ field: 'ptPrice', level: 'error', message: 'قیمت PT باید بین ۰ و ۱ (بر حسب دارایی پایه) باشد.' });
  if (!(p.ytPrice > 0 && p.ytPrice < 1))
    issues.push({ field: 'ytPrice', level: 'error', message: 'قیمت YT باید بین ۰ و ۱ (بر حسب دارایی پایه) باشد.' });
  if (p.ptPrice > 0 && p.ytPrice > 0 && Math.abs(p.ptPrice + p.ytPrice - 1) > thresholds.ptYtParity.maxDeviation)
    issues.push({
      field: 'ytPrice',
      level: 'warning',
      message: 'جمع قیمت PT و YT از ۱ فاصله دارد؛ احتمالاً قیمت‌ها به واحدهای متفاوت وارد شده‌اند.',
    });
  if (!(p.daysToMaturity > 0))
    issues.push({ field: 'maturity', level: 'error', message: 'تاریخ سررسید باید در آینده باشد.' });
  return result(issues);
}

/** Full scenario validation — messages are shown next to the related inputs. */
export function validateScenario(p: ScenarioParams, now = Date.now()): ValidationResult {
  const days = new Date(p.maturity).getTime() > now ? daysUntil(p.maturity, now) : 0;
  const issues = validatePosition({ ...p, daysToMaturity: days }).issues.map((i) =>
    i.field === 'maturity' && p.marketId ? { ...i, message: 'این بازار منقضی شده؛ بازار دیگری انتخاب کنید.' } : i,
  );

  if (p.baseAPY < 0) issues.push({ field: 'baseAPY', level: 'error', message: 'APY پایه نمی‌تواند منفی باشد.' });
  if (!(p.ltv > 0 && p.ltv < 100)) issues.push({ field: 'ltv', level: 'error', message: 'LTV باید بین ۰ و ۱۰۰ باشد.' });
  if (p.ltv >= p.liquidationThreshold)
    issues.push({
      field: 'ltv',
      level: 'error',
      message: 'LTV هر حلقه باید کمتر از آستانه‌ی لیکوئیدیشن باشد.',
    });
  if (!Number.isInteger(p.loops) || p.loops < 0 || p.loops > 20)
    issues.push({ field: 'loops', level: 'error', message: 'تعداد حلقه باید عدد صحیح بین ۰ تا ۲۰ باشد.' });
  if (p.rangeLowerAPY >= p.rangeUpperAPY)
    issues.push({
      field: 'rangeLowerAPY',
      level: 'error',
      message: 'کف بازه‌ی CLMM باید کمتر از سقف آن باشد.',
    });
  if (p.rangeLowerAPY < 0)
    issues.push({ field: 'rangeLowerAPY', level: 'error', message: 'کف بازه نمی‌تواند منفی باشد.' });
  if (!(p.totalPointsSupply > 0))
    issues.push({ field: 'totalPointsSupply', level: 'error', message: 'کل عرضه‌ی پوینت باید بیشتر از صفر باشد.' });
  if (!(p.airdropAllocation >= 0 && p.airdropAllocation <= 100))
    issues.push({ field: 'airdropAllocation', level: 'error', message: 'سهم ایردراپ باید بین ۰ و ۱۰۰ درصد باشد.' });
  if (p.fdv < 0) issues.push({ field: 'fdv', level: 'error', message: 'FDV نمی‌تواند منفی باشد.' });
  if (p.ytMultiplier < 0 || p.lpMultiplier < 0 || p.pointsPerDay < 0)
    issues.push({ field: 'ytMultiplier', level: 'error', message: 'ضریب و نرخ پوینت نمی‌تواند منفی باشد.' });
  if (p.apyHistory.length > 0 && p.apyHistory.length < 7)
    issues.push({
      field: 'apyHistory',
      level: 'warning',
      message: 'برای تحلیل روند دست‌کم ۷ روز داده‌ی تاریخی لازم است.',
    });

  return result(issues);
}
