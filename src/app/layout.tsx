import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';
import { AppShell } from '../components/layout/AppShell';

export const metadata: Metadata = {
  title: 'YieldX — مشاور معاملات بازده',
  description: 'تحلیل ساده‌ی PT، YT، لوپینگ، CLMM و ایردراپ برای Exponent، Pendle و پروتکل‌های مشابه',
  applicationName: 'YieldX',
  appleWebApp: { capable: true, title: 'YieldX', statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#0B0B14',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fa" dir="rtl">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
