'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isActive, NAV } from './nav';

/**
 * Mobile / PWA bar: the four sections, above the iPhone home indicator
 * (safe area). Pages reserve its height (.pb-safe) so it never covers a form or
 * a final action. Hidden on desktop, where the header carries navigation.
 */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/90 backdrop-blur-md border-t border-default bottom-safe" aria-label="ناوبری اصلی">
      <ul className="flex max-w-lg mx-auto h-16">
        {NAV.map((item) => {
          const { href, short, icon: Icon } = item;
          const active = isActive(pathname, item);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`h-full flex flex-col items-center justify-center gap-1 text-xs font-medium transition-colors ${active ? 'text-primary' : 'text-muted'}`}
              >
                <span className={`grid place-items-center h-7 w-14 rounded-full transition-colors ${active ? 'bg-accent/15 text-accent' : ''}`}>
                  <Icon size={20} aria-hidden />
                </span>
                {short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
