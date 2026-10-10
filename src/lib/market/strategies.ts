import type { Opportunity } from '../../types/opportunity';

/**
 * Sections by strategy, across platforms: PT held to maturity (Pendle, Spectra,
 * Exponent) and the PT loop. A PT loop exists only where a lending market takes that
 * exact PT — matched by its contract address, never its symbol — as collateral
 * (`ptLenders` in opportunity/leverage.ts); without such a market no loop is built.
 */
export type StrategyId = 'pt' | 'loop';

export interface Strategy {
  id: StrategyId;
  name: string;
  /** What it is, in a few Persian words. */
  what: string;
  /** How it works, one or two sentences for the section's page. */
  how: string;
  test: (o: Pick<Opportunity, 'family' | 'maturity'>) => boolean;
}

export const STRATEGIES: Strategy[] = [
  {
    id: 'pt',
    name: 'PT',
    what: 'نرخ ثابت تا سررسید',
    how: 'PT را با تخفیف می‌خرید و در سررسید یک واحد دارایی پایه پس می‌گیرید؛ سود از روز خرید معلوم است. فقط بازارهایی که سررسیدشان داخل افق انتخابی است رتبه می‌گیرند.',
    test: (o) => o.family === 'pt',
  },
  {
    id: 'loop',
    name: 'لوپ PT',
    what: 'PT به‌عنوان وثیقه، با اهرم',
    how: 'PT را در بازار وامی که همین PT (با نشانی قرارداد) را وثیقه می‌پذیرد می‌گذارید، وام می‌گیرید و دوباره PT می‌خرید. بدون چنین بازار وامی لوپی ساخته نمی‌شود. سود = بازده PT روی کل موقعیت منهای بهره‌ی وام.',
    test: (o) => o.family === 'leverage' && o.maturity !== null,
  },
];

export const STRATEGY_IDS = STRATEGIES.map((s) => s.id);
export const strategyById = (id: string): Strategy | null => STRATEGIES.find((s) => s.id === id) ?? null;
