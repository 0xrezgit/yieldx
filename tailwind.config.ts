import type { Config } from 'tailwindcss';

/**
 * Quant Terminal theme — canonical tokens.
 * Colors, fonts and sizing are defined here (loaded by app/globals.css
 * through `@config`) so both Tailwind v3 tooling and the v4 compiler
 * resolve the same scale. Do not add ad-hoc px values to TSX; extend
 * this file instead.
 */
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Surfaces
        base: '#0B0E11', // page background
        surface: '#12161C', // cards
        elevated: '#1B2129', // inputs, table header, hover
        // Borders
        default: '#262D37', // default border (cards)
        strong: '#3A4350', // strong border (inputs, badges)
        // Text
        primary: '#EAECEF', // text-primary
        secondary: '#A8B3BF', // text-secondary (labels, helper text)
        muted: '#667085', // text-muted
        // Accents
        accent: '#5E6AD2',
        success: '#2EBD85',
        danger: '#F6465D',
        warning: '#F59E0B',
        info: '#38BDF8',
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config;
