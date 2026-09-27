import thresholds from '../config/thresholds.json';
import type { ScenarioParams } from '../types/scenario';
import { calculateImpliedMetrics, type ImpliedMetrics } from './calculators/implied-apy';
import { ptFixedReturn, ytPosition, ytYield, type YTPosition } from './calculators/pt-yt';
import { airdropValue, pointsEarned, pointsShare, valuePerPoint } from './calculators/airdrop';
import { calculatePointsValuation, type PointsValuation } from './calculators/points-valuation';
import { calculateAPYScenarios, type APYScenarioResult } from './calculators/apy-scenarios';
import { calculateLooping, type LoopingResult } from './calculators/looping';
import { calculateCLMM, type CLMMResult } from './calculators/clmm';
import { analyzeAPYTrend, type APYTrend } from './risk/apy-trend';
import { assessLiquidation, type LiquidationRisk, type RiskLevel } from './risk/liquidation';
import { daysUntil } from './utils/math';
import { validateScenario, type ValidationResult } from './utils/validation';

export type StrategyId = 'pt' | 'loop' | 'yt' | 'clmm';

export interface StrategySummary {
  id: StrategyId;
  name: string;
  /** Expected USD PnL to maturity. */
  pnl: number;
  /** PnL / capital, %. */
  roi: number;
  risk: RiskLevel;
}

export interface Analysis {
  days: number;
  validation: ValidationResult;
  implied: ImpliedMetrics;
  pt: { fixedReturn: number };
  yt: YTPosition & {
    yieldBase: number;
    points: number;
    airdropValue: number;
    netPnL: number;
    roi: number;
    valuation: PointsValuation;
  };
  scenarios: APYScenarioResult;
  trend: APYTrend | null;
  looping: LoopingResult & { liquidation: LiquidationRisk };
  clmm: CLMMResult & { airdropValue: number; netPnL: number };
  airdrop: { totalPoints: number; share: number; valuePerPoint: number; value: number };
  liquidity: { thin: boolean; positionShare: number | null };
  strategies: StrategySummary[];
  /** Strategies ordered by risk-adjusted PnL (empty when inputs are invalid). */
  ranked: StrategySummary[];
  best: StrategySummary | null;
}

const riskPenalty: Record<RiskLevel, number> = { low: 1, medium: 0.75, high: 0.5 };

/** Runs every calculator for one scenario. Pure — safe for server and client. */
export function analyzeScenario(p: ScenarioParams, now = Date.now()): Analysis {
  const days = daysUntil(p.maturity, now);
  const validation = validateScenario(p, now);
  const implied = calculateImpliedMetrics(p.ptPrice, days, p.baseAPY);
  const airdropInput = { fdv: p.fdv, allocation: p.airdropAllocation, totalPointsSupply: p.totalPointsSupply };
  const trend = analyzeAPYTrend(p.apyHistory, p.baseAPY);

  // Direct YT
  const posInput = { capital: p.capital, underlyingPrice: p.underlyingPrice, ytPrice: p.ytPrice, daysToMaturity: days };
  const pos = ytPosition(posInput);
  const yieldBase = ytYield(pos.notional, p.baseAPY, days);
  const ytPoints = pointsEarned(pos.units, p.pointsPerDay, p.ytMultiplier, days);
  const ytDrop = airdropValue(ytPoints, airdropInput);
  const valuation = calculatePointsValuation({
    capital: p.capital,
    yieldReturn: yieldBase,
    points: ytPoints,
    ...airdropInput,
  });
  const ytNet = yieldBase + ytDrop - p.capital;
  const scenarios = calculateAPYScenarios(p.baseAPY, p.apyHistory, posInput, ytDrop);

  // PT looping
  const loop = calculateLooping({
    capital: p.capital,
    ptPrice: p.ptPrice,
    ltv: p.ltv,
    loops: p.loops,
    borrowAPY: p.borrowAPY,
    daysToMaturity: days,
  });
  const liquidation = assessLiquidation(loop.aggregateLTV, p.liquidationThreshold, p.ptPrice, days);

  // CLMM
  const clmm = calculateCLMM({
    capital: p.capital,
    underlyingPrice: p.underlyingPrice,
    impliedAPY: implied.impliedAPY,
    rangeLowerAPY: p.rangeLowerAPY,
    rangeUpperAPY: p.rangeUpperAPY,
    feeAPY: p.feeAPY,
    daysToMaturity: days,
    pointsPerDay: p.pointsPerDay,
    lpMultiplier: p.lpMultiplier,
    apyVolatility: trend?.volatility ?? 0,
  });
  const clmmDrop = airdropValue(clmm.points, airdropInput);

  const totalPoints = p.existingPoints + ytPoints;
  const positionShare = p.liquidity && p.liquidity > 0 ? p.capital / p.liquidity : null;

  const ytRisk: RiskLevel =
    valuation.recommendation === 'avoid' || trend?.risk === 'high' ? 'high' : 'medium';

  const strategies: StrategySummary[] = [
    { id: 'pt', name: 'نگهداری PT', pnl: ptFixedReturn(p.capital, p.ptPrice), risk: 'low' },
    { id: 'loop', name: 'لوپینگ PT', pnl: loop.profitToMaturity, risk: liquidation.risk },
    { id: 'yt', name: 'خرید مستقیم YT', pnl: ytNet, risk: ytRisk },
    { id: 'clmm', name: 'نقدینگی CLMM', pnl: clmm.feeIncome + clmmDrop, risk: clmm.risk },
  ].map((s) => ({ ...s, roi: (s.pnl / p.capital) * 100 }) as StrategySummary);

  const score = (s: StrategySummary) => (s.pnl > 0 ? s.pnl * riskPenalty[s.risk] : s.pnl);
  const ranked = validation.valid ? [...strategies].sort((a, b) => score(b) - score(a)) : [];

  return {
    days,
    validation,
    implied,
    pt: { fixedReturn: ptFixedReturn(p.capital, p.ptPrice) },
    yt: {
      ...pos,
      yieldBase,
      points: ytPoints,
      airdropValue: ytDrop,
      netPnL: ytNet,
      roi: (ytNet / p.capital) * 100,
      valuation,
    },
    scenarios,
    trend,
    looping: { ...loop, liquidation },
    clmm: { ...clmm, airdropValue: clmmDrop, netPnL: clmm.feeIncome + clmmDrop },
    airdrop: {
      totalPoints,
      share: pointsShare(totalPoints, p.totalPointsSupply),
      valuePerPoint: valuePerPoint(airdropInput),
      value: airdropValue(totalPoints, airdropInput),
    },
    liquidity: {
      thin: p.liquidity !== null && p.liquidity < thresholds.liquidity.thinUsd,
      positionShare,
    },
    strategies,
    ranked,
    best: ranked[0] && ranked[0].pnl > 0 ? ranked[0] : null,
  };
}
