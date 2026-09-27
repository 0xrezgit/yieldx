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
      },
      fontFamily: {
        sans: ['Vazirmatn', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
