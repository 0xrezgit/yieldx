import type { Metadata } from 'next';
import PositionDetail from '../../../components/portfolio/PositionDetail';

export const metadata: Metadata = { title: 'پوزیشن — YieldX' };

export default async function PositionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PositionDetail id={decodeURIComponent(id)} />;
}
