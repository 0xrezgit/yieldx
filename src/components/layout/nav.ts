import { ChartCandlestick, Wallet } from 'lucide-react';

/**
 * The app's two sections, shared by the desktop header and the mobile bottom bar.
 * `also`: paths that belong to a section (its tools, calculators, old addresses).
 */
export const NAV = [
  { href: '/', label: 'تحلیل بازار', short: 'تحلیل بازار', icon: ChartCandlestick, also: ['/tools', '/dashboard', '/history', '/guide', '/opportunities'] },
  { href: '/portfolio', label: 'پرتفوی من', short: 'پرتفوی من', icon: Wallet, also: [] as string[] },
] as const;

const under = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + '/');

export const isActive = (pathname: string, item: { href: string; also: readonly string[] }) =>
  item.href === '/' ? pathname === '/' || item.also.some((a) => under(pathname, a)) : under(pathname, item.href) || item.also.some((a) => under(pathname, a));
