'use client';

import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useIsMobile } from '../../hooks/useIsMobile';
import { useShell } from '../layout/AppShell';
import { isReady, useDashboard } from './useDashboard';
import { MobileDashboard } from './MobileDashboard';
import { WebDashboard } from './WebDashboard';

/** Picks the mobile (PWA) or web layout; both share the same state. */
export default function Dashboard() {
  const d = useDashboard();
  const mobile = useIsMobile();
  const { setAlertCount, setTab } = useShell();

  // Opening a saved scenario (from history) goes straight to its result on mobile.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('scenario')) setTab('result');
  }, [setTab]);

  const count = d.verdict
    ? d.triggered.length +
      d.insights.filter(
        (i) => (i.severity === 'critical' || i.severity === 'warning') && (!i.strategy || i.strategy === d.verdict?.best?.id),
      ).length
    : 0;

  useEffect(() => setAlertCount(count), [count, setAlertCount]);

  if (!isReady(d)) {
    return (
      <main className="grid place-items-center py-24 text-secondary">
        <Loader2 className="animate-spin" />
      </main>
    );
  }

  return mobile ? <MobileDashboard d={d} /> : <WebDashboard d={d} />;
}
