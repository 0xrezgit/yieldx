import type { Config } from 'tailwindcss';

/**
 * YieldX theme tokens (loaded by src/app/globals.css through `@config`).
 * Stripe-inspired dark system: near-black canvas, #1A1A22 surfaces, hairline
 * #32323A borders, one violet accent (#533AFD / #7662FD), emerald for gains,
 * orange for warnings (kept apart from red losses). One colour per strategy.
 * Extend this file instead of adding ad-hoc colours in TSX.
 */
export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces
        base: '#0B0B14',
        surface: '#1A1A22',
        elevated: '#26262E',
        // Borders
        default: '#32323A',
        strong: '#45455A',
        // Text
        primary: '#F8F7FF',
        secondary: '#B4B3BD',
        muted: '#85848F',
        // Brand
        accent: '#7662FD',
        brand2: '#533AFD',
        // Status
        success: '#15BE53',
        warning: '#FF6201',
        danger: '#F2545B',
        info: '#4285F4',
        // Strategies
        'st-pt': '#4285F4',
        'st-loop': '#A78BFA',
        'st-yt': '#F59E0B',
        'st-clmm': '#15BE53',
        // Positions section — Stripe-inspired dark theme (derived dark palette).
        'sx-bg': '#0B0B14',
        'sx-surface': '#1A1A22',
        'sx-raised': '#26262E',
        'sx-text': '#F8F7FF',
        'sx-muted': '#9E9DA6',
        'sx-faint': '#85848F',
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
