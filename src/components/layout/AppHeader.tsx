'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Download, Sparkles } from 'lucide-react';
import { useShell } from './AppShell';
import { isActive, NAV } from './nav';

export function Logo() {
  return (
    <Link href="/opportunities" className="flex items-center gap-2 shrink-0 min-h-11" aria-label="YieldX — صفحه‌ی فرصت‌ها">
      <span className="grid place-items-center size-8 rounded-lg bg-brand text-white">
        <Sparkles size={16} aria-hidden />
      </span>
      <span className="font-bold text-lg tracking-tight text-primary" dir="ltr">
        YieldX
      </span>
    </Link>
  );
}

/** Fixed, low header. Desktop: all destinations with a clear active state. Mobile: logo only (navigation is in the bottom bar). */
export function AppHeader() {
  const pathname = usePathname();
  const { install } = useShell();

  return (
    <header className="sticky top-0 z-30 bg-canvas/95 backdrop-blur border-b border-default">
      <div className="max-w-matrix mx-auto px-[var(--space-page-x)] h-14 flex items-center justify-between gap-3">
        <Logo />
        <nav className="hidden lg:flex items-stretch h-full gap-1" aria-label="ناوبری اصلی">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`relative flex items-center gap-2 px-3.5 text-[15px] transition-colors ${active ? 'text-primary font-semibold' : 'text-secondary hover:text-primary'}`}
              >
                <Icon size={16} aria-hidden /> {label}
                {active && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent" aria-hidden />}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2 min-w-[5rem] justify-end">
          {install && (
            <button type="button" onClick={install} className="tap flex items-center gap-1.5 rounded-lg border border-accent/60 px-3 min-h-9 text-sm text-primary">
              <Download size={15} aria-hidden /> نصب اپ
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
