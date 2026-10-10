# YieldX design system

Adapted from Linear's `DESIGN.md` in [open-design](https://github.com/nexu-io/open-design/tree/main/design-systems/linear-app) (only the document was used — no code from that repo runs in this app), for a dark, data-dense, right-to-left Persian app. The one implementation is `src/app/globals.css` (tokens and component classes) plus `tailwind.config.ts` (token names). Never add a colour in TSX.

## Principles

- **Dark-first, depth by luminance.** `bg → surface → raised → hover`, each one step lighter. No drop shadows on dark surfaces; only floating layers (`.sx-pop`) get one.
- **Accent is for interaction only.** Brand indigo fills the one primary action of a view; accent violet marks selection, links and focus. Never decorative.
- **Hierarchy from type, not boxes.** Three weights: 400 (reading), 510 (UI, labels), 590 (titles, key figures). Nothing heavier.
- **Persian first.** No negative letter-spacing (it breaks joined letters). Every digit renders Persian; numbers are LTR isolates inside RTL text (`<Num>`).

## Tokens

| Token | Value | Use |
| --- | --- | --- |
| `canvas` | `#08090A` | page background, recessed tracks |
| `surface` | `#0F1011` | cards, panels, bars |
| `elevated` | `#18191B` | inputs, nested blocks |
| `hover` | `#222327` | hover, selected segment, neutral chips |
| `default` / `strong` | `#202226` / `#2E3036` | hairline borders / secondary-button border |
| `control` | `#62666D` | input borders (3:1) |
| `primary` / `secondary` / `muted` | `#F7F8F8` / `#D0D6E0` / `#8A8F98` | text (≥ 4.5:1 everywhere) |
| `brand` | `#5E6AD2` | primary button fill (white text 4.7:1) |
| `accent` | `#8A89FF` | selection, links, focus ring |
| `success` · `danger` · `warning` · `info` | `#3ECF8E` · `#F0636B` · `#F2C94C` · `#4EA7FC` | status, profit / loss |

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
- Desktop (≥ 1024px): destinations move into the header as quiet tabs; ranking rows switch to three columns through a container query (`.rank-row`).
- Touch targets ≥ 44px on coarse pointers (`.tap`). Inputs are 16px so iOS never zooms.
- Market analysis is split by platform (`lib/market/platforms.ts`): «All» (`/`) and one page per protocol (`/p/<id>`), switched by a sticky strip of logo chips under the header (`PlatformStrip`; it scrolls on phones and wraps on desktop). Capital and horizon are shared by every page.
- «All» shows one card per platform (`PlatformCards`): logo, what it does, the best net dollars for the capital and horizon (the one figure in large green), its market, and how many rank; cards are sorted by that figure. The verified vaults are one more card. The combined ranking follows the cards.
- Two strategy sections sit before the platforms in the strip and on «All» (`lib/market/strategies.ts`): **PT** (`/s/pt`, every PT held to maturity across Pendle, Spectra and Exponent) and **Loop PT** (`/s/loop`). A PT loop exists only where a lending market takes that exact PT — by contract address — as collateral (`ptLenders`); the section says so in its header. Strategy pages hide the type filter.

