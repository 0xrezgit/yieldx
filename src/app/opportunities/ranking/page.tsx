import type { Metadata } from 'next';
import LendingOpportunities from '../../../components/lending/LendingOpportunities';

export const metadata: Metadata = { title: 'رتبه‌بندی یکپارچه — YieldX' };

export default function RankingPage() {
  return <LendingOpportunities />;
}
