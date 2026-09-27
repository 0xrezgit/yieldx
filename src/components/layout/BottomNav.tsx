'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Bell, ChartPie, History, SlidersHorizontal } from 'lucide-react';
import { useShell, type MobileTab } from './AppShell';
import { formatNumber } from '../../lib/utils/formatting';

const tabs: { id: MobileTab; label: string; icon: typeof Bell }[] = [
  { id: 'market', label: 'بازار', icon: SlidersHorizontal },
  { id: 'result', label: 'نتیجه', icon: ChartPie },
  { id: 'alerts', label: 'هشدارها', icon: Bell },
];

/** Mobile / PWA tab bar. Hidden on desktop, where the header carries navigation. */
export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { tab, setTab, alertCount } = useShell();
  const onDashboard = pathname === '/dashboard';
  const onHistory = pathname.startsWith('/history');

  const item = (active: boolean) =>
    `relative flex flex-col items-center justify-center gap-0.5 flex-1 py-2 text-xs transition-colors ${
      active ? 'text-primary' : 'text-muted'
    }`;

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur-lg border-t border-default bottom-safe">
      <div className="flex max-w-lg mx-auto">
        {tabs.map(({ id, label, icon: Icon }) => {
          const active = onDashboard && tab === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => {
                setTab(id);
                if (!onDashboard) router.push('/dashboard');
              }}
              className={item(active)}
              aria-current={active ? 'page' : undefined}
            >
              {active && <span className="absolute top-0 h-0.5 w-8 rounded-full brand-gradient" />}
              <span className="relative">
                <Icon size={22} />
                {id === 'alerts' && alertCount > 0 && (
                  <span className="absolute -top-1.5 -left-2 min-w-4 h-4 px-1 rounded-full bg-danger text-[10px] leading-4 text-white text-center num">
                    {formatNumber(alertCount, 0)}
                  </span>
                )}
              </span>
              {label}
            </button>
          );
        })}
        <button type="button" onClick={() => router.push('/history')} className={item(onHistory)} aria-current={onHistory ? 'page' : undefined}>
          {onHistory && <span className="absolute top-0 h-0.5 w-8 rounded-full brand-gradient" />}
          <History size={22} />
          سناریوها
        </button>
      </div>
    </nav>
  );
}
