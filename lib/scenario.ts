/**
 * Scenario domain types + pure helpers.
 * Business math is intentionally unchanged from the original dashboard;
 * only formatting/types were extracted here so the UI layer can stay focused.
 */

export interface ScenarioParams {
  capital: number;
  pu: number;
  ry: number;
  pt: number;
  ltv: number;
  loops: number;
  borrow: number;
  threshold: number;
  yt: number;
  mult: number;
  fee: number;
  lpm: number;
  min: number;
  max: number;
  vol: number;
  fdv: number;
  air: number;
  points: number;
  myPoints: number;
  ppd: number;
  airdrop: string;
}

export type ScenarioKey = keyof ScenarioParams;
export type ScenarioSetter = (key: ScenarioKey, value: ScenarioParams[ScenarioKey]) => void;

export const defaultScenario: ScenarioParams = {
  capital: 10000,
  pu: 1,
  ry: 8,
  pt: 0.92,
  ltv: 75,
  loops: 3,
  borrow: 5,
  threshold: 85,
  yt: 0.18,
  mult: 2,
  fee: 12,
  lpm: 1.5,
  min: 5,
  max: 20,
  vol: 1,
  fdv: 100000000,
  air: 10,
  points: 10000000,
  myPoints: 120000,
  ppd: 350,
  airdrop: '2026-12-31',
};

export const finite = (x: number) => (Number.isFinite(x) ? x : 0);

export const money = (x: number) =>
  '$' + finite(x).toLocaleString(undefined, { maximumFractionDigits: 2 });

export const daysUntil = (airdrop: string) =>
  Math.max(1, Math.ceil((new Date(airdrop).getTime() - Date.now()) / 86400000));
