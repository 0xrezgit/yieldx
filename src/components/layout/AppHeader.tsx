'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CircleHelp, Download, Sparkles } from 'lucide-react';
import { useShell } from './AppShell';
import { isActive, NAV } from './nav';

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 shrink-0 min-h-11" aria-label="YieldX — تحلیل بازار">
      <span className="grid place-items-center size-7 rounded-lg bg-brand text-on-brand">
        <Sparkles size={15} aria-hidden />
      </span>
      <span className="font-semibold text-[17px] text-primary" dir="ltr">
        YieldX
      </span>
    </Link>
  );
}

/**
 * Sticky, low header (below the notch in the installed PWA). Desktop: the destinations
 * as quiet tabs. Mobile: logo and help only — navigation is in the bottom bar.
 */
export function AppHeader() {
  const pathname = usePathname();
  const { install } = useShell();

  return (
    <header className="top-safe sticky top-0 z-30 bg-canvas/85 backdrop-blur-md border-b border-default">
      <div className="max-w-matrix mx-auto px-[var(--space-page-x)] h-[var(--header-h)] flex items-center justify-between gap-3">
        <div className="flex items-center gap-6 h-full">
          <Logo />
          <nav className="hidden lg:flex items-center gap-0.5 rounded-full border border-default bg-surface/80 p-1" aria-label="ناوبری اصلی">
          {NAV.map((item) => {
            const { href, label, icon: Icon } = item;
            const active = isActive(pathname, item);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-2 px-3.5 min-h-8 rounded-full text-sm font-medium transition-colors ${active ? 'bg-hover text-primary shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]' : 'text-muted hover:text-primary'}`}
              >
                <Icon size={16} aria-hidden className={active ? 'text-accent' : ''} /> {label}
              </Link>
            );
          })}
          </nav>
        </div>
        <div className="flex items-center gap-2 min-w-[5rem] justify-end">
          <Link href="/guide" className="tap grid place-items-center size-9 rounded-md text-muted hover:text-primary hover:bg-raised" aria-label="راهنما">
            <CircleHelp size={18} aria-hidden />
          </Link>
          {install && (
            <button type="button" onClick={install} className="tap flex items-center gap-1.5 rounded-md border border-strong bg-white/[0.03] px-3 min-h-9 text-sm font-medium text-primary hover:bg-hover">
              <Download size={15} aria-hidden /> نصب اپ
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
