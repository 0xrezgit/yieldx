import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    // The installed app's identity stays the same; it now opens on the market analysis.
    id: '/dashboard',
    name: 'YieldX — مشاور معاملات بازده',
    short_name: 'YieldX',
    description: 'رتبه‌بندی فرصت‌های بازده بر اساس سود خالص دلاری، و پرتفوی شخصی',
    lang: 'fa',
    dir: 'rtl',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#070B11',
    theme_color: '#070B11',
    categories: ['finance'],
    icons: [
      { src: '/pwa-icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'تحلیل بازار', url: '/' },
      { name: 'پرتفوی من', url: '/portfolio' },
    ],
  };
}
