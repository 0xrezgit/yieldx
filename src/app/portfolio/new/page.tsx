import type { Metadata } from 'next';
import NewPosition from '../../../components/portfolio/NewPosition';

export const metadata: Metadata = { title: 'ثبت پوزیشن — YieldX' };

export default function NewPositionPage() {
  return <NewPosition />;
}
