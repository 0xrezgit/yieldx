import Link from 'next/link';
import { CalendarClock, CircleDollarSign, Gift, Trophy } from 'lucide-react';

const SECTIONS = [
  { href: '/opportunities/ranking', id: 'ranking', label: 'رتبه‌بندی یکپارچه', short: 'رتبه‌بندی', sub: 'همه‌ی خانواده‌ها · سود خالص دلاری', icon: Trophy },
  { href: '/opportunities', id: 'markets', label: 'بازارهای سررسیددار', short: 'PT · YT', sub: 'PT · YT · Loop · تحلیل تخصصی', icon: CalendarClock },
  { href: '/opportunities/stable', id: 'stable', label: 'پیشنهاد استیبل‌کوین', short: 'استیبل', sub: 'PT Loop با نرخ وام شما', icon: CircleDollarSign },
  { href: '/opportunities/merkl', id: 'merkl', label: 'پاداش‌های Merkl', short: 'Merkl', sub: 'همه‌ی شبکه‌ها و پروتکل‌ها', icon: Gift },
] as const;

/** The parts of «فرصت‌ها»: the unified ranking, fixed-maturity markets (PT/YT specialist tools), stablecoin suggestions and Merkl incentives. */
export function SectionSwitch({ current }: { current: 'ranking' | 'markets' | 'stable' | 'merkl' }) {
  return (
    <nav aria-label="بخش‌های فرصت‌ها" className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 rounded-lg bg-surface border border-default">
      {SECTIONS.map((s) => {
        const active = s.id === current;
        const Icon = s.icon;
        return (
          <Link
            key={s.id}
            href={s.href}
            aria-current={active ? 'page' : undefined}
            className={`tap flex items-center justify-center gap-2 rounded-md px-2 min-h-11 text-center transition-colors ${active ? 'bg-elevated text-primary ring-1 ring-accent' : 'text-secondary hover:text-primary'}`}
          >
            <Icon size={16} className={`hidden sm:block ${active ? 'text-accent' : ''}`} aria-hidden />
            <span className="flex flex-col leading-tight min-w-0">
              <span className={`text-sm sm:text-[15px] truncate ${active ? 'font-semibold' : ''}`}>
                <span className="sm:hidden">{s.short}</span>
                <span className="hidden sm:inline">{s.label}</span>
              </span>
              <span className="hidden sm:block text-xs text-muted truncate">{s.sub}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
