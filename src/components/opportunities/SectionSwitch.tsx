import Link from 'next/link';
import { CalendarClock, Gift } from 'lucide-react';

const SECTIONS = [
  { href: '/opportunities', id: 'markets', label: 'بازارهای سررسیددار', sub: 'PT · YT · Loop', icon: CalendarClock },
  { href: '/opportunities/merkl', id: 'merkl', label: 'پاداش‌های Merkl', sub: 'همه‌ی شبکه‌ها و پروتکل‌ها', icon: Gift },
] as const;

/** The two independent parts of «فرصت‌ها»: fixed-maturity markets and Merkl incentives. Separate data, separate maths. */
export function SectionSwitch({ current }: { current: 'markets' | 'merkl' }) {
  return (
    <nav aria-label="بخش‌های فرصت‌ها" className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-surface border border-default">
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
            <Icon size={16} className={active ? 'text-accent' : ''} aria-hidden />
            <span className="flex flex-col leading-tight min-w-0">
              <span className={`text-[15px] truncate ${active ? 'font-semibold' : ''}`}>{s.label}</span>
              <span className="hidden sm:block text-xs text-muted truncate">{s.sub}</span>
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
