import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/dashboard',
    name: 'YieldX — مشاور معاملات بازده',
    short_name: 'YieldX',
    description: 'تحلیل ساده‌ی PT، YT، لوپینگ و ایردراپ',
    lang: 'fa',
    dir: 'rtl',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0B0D12',
    theme_color: '#0B0D12',
    categories: ['finance'],
    icons: [
      { src: '/pwa-icon/192', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/pwa-icon/512', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'فرصت‌ها', url: '/opportunities' },
      { name: 'تحلیل بازار', url: '/dashboard' },
      { name: 'پرتفوی من', url: '/portfolio' },
    ],
  };
}
