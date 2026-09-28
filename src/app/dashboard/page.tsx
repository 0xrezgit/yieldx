import type { Metadata } from 'next';
import Dashboard from '../../components/dashboard/Dashboard';

export const metadata: Metadata = { title: 'داشبورد — YieldX' };

export default function DashboardPage() {
  return <Dashboard />;
}
