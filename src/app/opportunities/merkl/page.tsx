import type { Metadata } from 'next';
import MerklOpportunities from '../../../components/merkl/MerklOpportunities';

export const metadata: Metadata = { title: 'پاداش‌های Merkl — YieldX' };

export default function MerklPage() {
  return <MerklOpportunities />;
}
