import type { Config } from 'tailwindcss';

/**
 * YieldX theme tokens (loaded by src/app/globals.css through `@config`).
 * Deep-navy surfaces, violet→cyan brand, one colour per strategy.
 * Extend this file instead of adding ad-hoc colours in TSX.
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces
        base: '#0A0F1E',
        surface: '#111831',
        elevated: '#1A2344',
        // Borders
        default: '#222C50',
        strong: '#33406E',
        // Text
        primary: '#EEF2FF',
        secondary: '#A9B4D6',
        muted: '#6E79A0',
        // Brand
        accent: '#7C5CFF',
        brand2: '#22D3EE',
        // Status
        success: '#34D399',
        warning: '#FBBF24',
        danger: '#FB7185',
        info: '#38BDF8',
        // Strategies
        'st-pt': '#38BDF8',
        'st-loop': '#A78BFA',
        'st-yt': '#F59E0B',
        'st-clmm': '#34D399',
        // Positions section — Stripe-inspired dark theme (derived dark palette).
        'sx-bg': '#0B0B14',
        'sx-surface': '#1A1A22',
        'sx-raised': '#26262E',
        'sx-text': '#F8F7FF',
        'sx-muted': '#9E9DA6',
        'sx-faint': '#6F6E7A',
        'sx-border': '#32323A',
        'sx-accent': '#7662FD',
        'sx-primary': '#533AFD',
        'sx-green': '#15BE53',
        'sx-orange': '#FF6201',
        'sx-red': '#F2545B',
        'sx-blue': '#4285F4',
      },
      fontFamily: {
        sans: ['Vazirmatn', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
