import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import MarketAnalysis from '../../../components/market/MarketAnalysis';
import { strategyById, STRATEGY_IDS } from '../../../lib/market/strategies';

/** One page per strategy section (PT, PT loop); any other address is not found. */
export const dynamicParams = false;
export const generateStaticParams = () => STRATEGY_IDS.map((strategy) => ({ strategy }));

export async function generateMetadata({ params }: { params: Promise<{ strategy: string }> }): Promise<Metadata> {
  const { strategy } = await params;
  const s = strategyById(strategy);
  return { title: s ? `${s.name} — YieldX` : 'YieldX' };
}

export default async function StrategyPage({ params }: { params: Promise<{ strategy: string }> }) {
  const { strategy } = await params;
  const s = strategyById(strategy);
  if (!s) notFound();
  return <MarketAnalysis strategy={s.id} />;
}
