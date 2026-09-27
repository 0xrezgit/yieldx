import thresholds from '../../config/thresholds.json';
import { ytPnL, type YTPositionInput } from './pt-yt';

export type ScenarioCase = 'bear' | 'base' | 'bull';

export interface APYScenario {
  label: string;
  apy: number;
  /** Yield-only PnL of the YT position, USD. */
  pnl: number;
  /** PnL including the expected airdrop value, USD. */
  pnlWithAirdrop: number;
  probability: number;
}

export interface APYScenarioResult {
  scenarios: Record<ScenarioCase, APYScenario>;
  expectedPnL: number;
  expectedPnLWithAirdrop: number;
  /** True when bear/bull came from real history rather than the fallback spread. */
  fromHistory: boolean;
}

/**
 * Bear / base / bull outcomes for a YT position. Bear and bull use the historical
 * min/max of the base APY; without history they fall back to ± a configured spread.
 */
export function calculateAPYScenarios(
  baseAPY: number,
  historicalAPYs: number[],
  position: YTPositionInput,
  airdropValue = 0,
): APYScenarioResult {
  const fromHistory = historicalAPYs.length > 0;
  const spread = thresholds.scenarios.fallbackSpread;
  const min = fromHistory ? Math.min(...historicalAPYs, baseAPY) : baseAPY * (1 - spread);
  const max = fromHistory ? Math.max(...historicalAPYs, baseAPY) : baseAPY * (1 + spread);

  const make = (label: string, apy: number, probability: number): APYScenario => {
    const pnl = ytPnL(position, apy);
    return { label, apy, pnl, pnlWithAirdrop: pnl + airdropValue, probability };
  };

  const scenarios = {
    bear: make('بدبینانه', min, thresholds.scenarios.bearProbability),
    base: make('واقع‌بینانه', baseAPY, thresholds.scenarios.baseProbability),
    bull: make('خوش‌بینانه', max, thresholds.scenarios.bullProbability),
  };

  const all = Object.values(scenarios);
  return {
    scenarios,
    expectedPnL: all.reduce((sum, s) => sum + s.pnl * s.probability, 0),
    expectedPnLWithAirdrop: all.reduce((sum, s) => sum + s.pnlWithAirdrop * s.probability, 0),
    fromHistory,
  };
}
