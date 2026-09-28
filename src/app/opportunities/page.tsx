import type { Metadata } from 'next';
import Opportunities from '../../components/opportunities/Opportunities';

export const metadata: Metadata = { title: 'فرصت‌ها — YieldX' };

export default function OpportunitiesPage() {
  return <Opportunities />;
}
