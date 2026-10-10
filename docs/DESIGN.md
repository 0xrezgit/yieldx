# YieldX design system

«Midnight» palette (2026-10-10). Layout adapted from Linear's `DESIGN.md` in [open-design](https://github.com/nexu-io/open-design/tree/main/design-systems/linear-app) (only the document was used — no code from that repo runs in this app), for a dark, data-dense, right-to-left Persian app. The one implementation is `src/app/globals.css` (tokens and component classes) plus `tailwind.config.ts` (token names). Never add a colour in TSX.

## Principles

- **Dark-first, depth by luminance.** `bg → surface → raised → hover`, each one step lighter. No drop shadows on dark surfaces; only floating layers (`.sx-pop`) get one.
- **Accent is for interaction only.** Brand sky-blue (dark text on it) fills the one primary action of a view; the lighter accent marks selection, links and focus. The best pick's soft glow is the only decorative colour.
- **Hierarchy from type, not boxes.** Three weights: 400 (reading), 510 (UI, labels), 590 (titles, key figures). Nothing heavier.
- **Persian first.** No negative letter-spacing (it breaks joined letters). Every digit renders Persian; numbers are LTR isolates inside RTL text (`<Num>`).

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `canvas` | `#070B11` | page background, recessed tracks |
| `surface` | `#0E141C` | cards, panels, bars |
| `elevated` / `raised` | `#151D28` | inputs, nested blocks |
| `hover` | `#1D2734` | hover, selected segment, neutral chips |
| `default` / `strong` | `#1A2330` / `#293547` | hairline borders / secondary-button border |
| `control` | `#5A6779` | input borders (3:1) |
| `primary` / `secondary` / `muted` | `#F1F5F9` / `#C3CDD9` / `#8794A6` | text (≥ 4.5:1 everywhere) |
| `brand` / `on-brand` | `#38BDF8` / `#04121C` | primary button fill and its text (9.6:1) |
| `accent` | `#7DD3FC` | selection, links, focus ring |
| `success` · `danger` · `warning` · `info` | `#4ADE80` · `#FB7185` · `#FACC15` · `#A78BFA` | status, profit / loss |

Radius: 6px controls and buttons · 8px tiles · 12px cards (`.sx-card`) · full for chips and pills.

## Numbers and fonts

Vazirmatn (variable, self-hosted) is the only typeface. `public/fonts/Vazirmatn-FD-Digits.woff2` is a subset of the same font, built with fontTools, whose `0–9` draw as `۰–۹`. It is loaded for `U+0030–0039` only, so any Latin digit (API symbols, dates, versions) appears Persian, while copying still yields Latin digits. Strings that must read in Latin digits (contract addresses) take the `.latin` class; `font-mono` uses the Latin face too. Formatters in `lib/utils/formatting.ts` still emit Persian digits, so text is Persian even before the font loads.

To rebuild the digits font after a Vazirmatn update: subset the variable font to `U+06F0–06F9` (keep `tnum`), then point cmap `0x30+i` at the glyph of `U+06F0+i`.

## Components

| Pattern | Class / component | Rule |
| --- | --- | --- |
| Segmented control | `.seg` + `.seg-fit` (≤ 4 options, equal columns, labels may wrap) or `.seg-scroll .strip` (more) | `Segmented` in `opportunities/parts.tsx`. Keep labels short (2–3 words). |
| Tabs | `.tabs .strip` | Underline indicator inside the strip; never a visible scrollbar. |
| Primary button | `button.primary` / `primaryAction` | One per view or row. |
| Secondary button | `button.secondary` / `secondaryAction` | Translucent fill + `strong` border. |
| Card | `.sx-card`, `Card`, `Collapsible` | `p-4` phone, `p-6` desktop. |
| Chip | `Pill`, `Badge` | Rounded-full, tinted background, never colour alone. |
| Inline facts | `.meta` | Items wrap between each other, never inside one. |
| Checkbox / radio | native input, drawn by CSS | 20px, brand fill when checked. |
| Sticky bar | `.below-header` | Sits under the header, notch included. |

## Layout

- Page gutter `--space-page-x`: 16px phone, 32px desktop; content max 1200px.
- Phone / PWA: header (logo, help, install) and the bottom bar with the two sections; pages reserve `.pb-safe`. The header pads `env(safe-area-inset-top)` because the installed app's status bar is translucent.
- Desktop (≥ 1024px): destinations move into the header as quiet tabs; list rows become one line through a container query (`.line-row`: identity | figures | dollars | actions).
- Market analysis order: capital and holding period (one card) → the three rankings as cards that act as tabs (`.choice`: all opportunities, YT in dollars, PT loop) → the best pick (`.spotlight`, the only glow on the page, with the one filled button) → search and type filter → the rest of the list with quiet outlined actions. Until the user types a capital the field holds 1,000, so results show at once.
- A variable base yield is shown as a simulation (`ScenarioTable`): low / likely / high, cash result apart from an assumed points value.
- Touch targets ≥ 44px on coarse pointers (`.tap`). Inputs are 16px so iOS never zooms.
- Market analysis is one page (`/`), not split by platform: each row carries its protocol's logo and the link into it. Old `/p/<id>` and `/s/<id>` addresses redirect (`/s/loop` → `/?view=loop`); `?view=yt|loop` and `?q=` open a view or a search.

