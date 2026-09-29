import { BookOpen, ChartCandlestick, FlaskConical, Radar, Wallet } from 'lucide-react';

/**
 * The app's destinations, shared by the desktop header and the mobile bottom bar
 * (five at most). Routes are unchanged; only labels are task-oriented.
 */
export const NAV = [
  { href: '/opportunities', label: 'فرصت‌ها', short: 'فرصت‌ها', icon: Radar },
  { href: '/dashboard', label: 'تحلیل بازار', short: 'تحلیل', icon: ChartCandlestick },
  { href: '/portfolio', label: 'پرتفوی من', short: 'پرتفوی', icon: Wallet },
  { href: '/history', label: 'سناریوها', short: 'سناریوها', icon: FlaskConical },
  { href: '/guide', label: 'راهنما', short: 'راهنما', icon: BookOpen },
] as const;

export const isActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(href + '/');
