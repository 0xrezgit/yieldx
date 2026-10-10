import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import MarketAnalysis from '../../../components/market/MarketAnalysis';
import { platformById, PLATFORM_IDS } from '../../../lib/market/platforms';

/** One page per platform; any other address is not found. */
export const dynamicParams = false;
export const generateStaticParams = () => PLATFORM_IDS.map((platform) => ({ platform }));

export async function generateMetadata({ params }: { params: Promise<{ platform: string }> }): Promise<Metadata> {
  const { platform } = await params;
  const p = platformById(platform);
  return { title: p ? `${p.name} — YieldX` : 'YieldX' };
}

export default async function PlatformPage({ params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params;
  const p = platformById(platform);
  if (!p) notFound();
  return <MarketAnalysis platform={p.id} />;
}
