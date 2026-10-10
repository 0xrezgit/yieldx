import type { Config } from 'tailwindcss';

/**
 * YieldX theme (docs/DESIGN.md) — every colour points at a CSS variable defined once in
 * src/app/globals.css (with measured contrast ratios). Older names (sx-*, brand2…)
 * map to the same tokens so the whole app shares one palette.
 * Extend the variables instead of adding ad-hoc colours in TSX.
 */
const v = (name: string) => `var(--c-${name})`;

export default {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces
        canvas: v('bg'),
        surface: v('surface'),
        elevated: v('raised'),
        raised: v('raised'),
        hover: v('hover'),
        // Borders
        default: v('border'),
        strong: v('border-strong'),
        control: v('control-border'),
        // Text
        primary: v('text'),
        secondary: v('secondary'),
        muted: v('muted'),
        // Interaction
        accent: v('accent'),
        brand: v('brand'),
        'on-brand': v('on-brand'),
        brand2: v('brand'),
        // Status
        success: v('success'),
        warning: v('warning'),
        danger: v('danger'),
        info: v('info'),
        // Strategies
        'st-pt': v('st-pt'),
        'st-loop': v('st-loop'),
        'st-yt': v('st-yt'),
        'st-clmm': v('st-clmm'),
        // Legacy names of the positions section — same tokens.
        'sx-bg': v('bg'),
        'sx-surface': v('surface'),
        'sx-raised': v('raised'),
        'sx-text': v('text'),
        'sx-muted': v('secondary'),
        'sx-faint': v('muted'),
        'sx-border': v('border'),
        'sx-accent': v('accent'),
        'sx-primary': v('brand'),
        'sx-green': v('success'),
        'sx-orange': v('warning'),
        'sx-red': v('danger'),
        'sx-blue': v('info'),
      },
      fontFamily: {
        sans: ['Vazirmatn', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Tahoma', 'sans-serif'],
        mono: ['Vazirmatn Latin', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
