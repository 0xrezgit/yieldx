import type { Metadata } from 'next';
import MarketAnalysis from '../components/market/MarketAnalysis';

export const metadata: Metadata = { title: 'تحلیل بازار — YieldX' };

export default function Home() {
  return <MarketAnalysis />;
}
