'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Download, History, LayoutDashboard, Radar, Sparkles, Wallet } from 'lucide-react';
import { useShell } from './AppShell';

const links = [
  { href: '/dashboard', label: 'داشبورد', icon: LayoutDashboard },
  { href: '/opportunities', label: 'فرصت‌ها', icon: Radar },
  { href: '/portfolio', label: 'پوزیشن‌ها', icon: Wallet },
  { href: '/history', label: 'سناریوها', icon: History },
  { href: '/guide', label: 'راهنما', icon: BookOpen },
];

export function Logo() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 shrink-0">
      <span className="grid place-items-center size-9 rounded-xl brand-gradient text-white shadow-lg shadow-accent/30">
        <Sparkles size={18} />
      </span>
      <span className="font-extrabold text-lg tracking-tight text-primary" dir="ltr">
        YieldX
      </span>
    </Link>
  );
}

/** Web: full navigation. Mobile/PWA: logo + guide + install only (navigation lives in the bottom bar). */
export function AppHeader() {
  const pathname = usePathname();
  const { install } = useShell();

  return (
    <header className="sticky top-0 z-20 bg-base/80 backdrop-blur-lg border-b border-default">
      <div className="max-w-matrix mx-auto px-4 md:px-6 h-14 lg:h-16 flex items-center justify-between gap-3">
        <Logo />

        <nav className="hidden lg:flex items-center gap-1">
          {links.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/');
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2 rounded-xl px-4 py-2 transition-colors ${
                  active ? 'bg-elevated text-primary' : 'text-secondary hover:text-primary'
                }`}
              >
                <Icon size={16} /> {label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          {install && (
            <button
              type="button"
              onClick={install}
              className="flex items-center gap-1.5 rounded-xl border border-accent/50 bg-accent/15 px-3 py-1.5 text-sm text-primary"
            >
              <Download size={15} /> نصب اپ
            </button>
          )}
          <Link href="/guide" aria-label="راهنما" className="lg:hidden p-2 rounded-xl text-secondary hover:text-primary">
            <BookOpen size={20} />
          </Link>
        </div>
      </div>
    </header>
  );
}
