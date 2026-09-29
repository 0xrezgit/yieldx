'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { isActive, NAV } from './nav';

/**
 * Mobile / PWA bar: the five destinations, above the iPhone home indicator
 * (safe area). Pages reserve its height (.pb-safe) so it never covers a form or
 * a final action. Hidden on desktop, where the header carries navigation.
 */
export function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-surface/95 backdrop-blur border-t border-default bottom-safe" aria-label="ناوبری اصلی">
      <ul className="flex max-w-lg mx-auto h-16">
        {NAV.map(({ href, short, icon: Icon }) => {
          const active = isActive(pathname, href);
          return (
            <li key={href} className="flex-1">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                className={`relative h-full flex flex-col items-center justify-center gap-0.5 text-xs transition-colors ${active ? 'text-primary font-semibold' : 'text-secondary'}`}
              >
                {active && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-accent" aria-hidden />}
                <Icon size={22} aria-hidden className={active ? 'text-accent' : ''} />
                {short}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
