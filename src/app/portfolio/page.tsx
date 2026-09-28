import type { Metadata } from 'next';
import Portfolio from '../../components/portfolio/Portfolio';

export const metadata: Metadata = { title: 'پرتفوی من — YieldX' };

export default function PortfolioPage() {
  return <Portfolio />;
}
