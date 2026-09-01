# UI/UX Audit — Quant Terminal · DeFi Yield & Airdrop Strategy Matrix

**Date:** 2026-09-01 · **Scope:** visual layout audit only (no business logic audited)
**Stack reality check:** Next.js 16 + Tailwind CSS **v4.3** (`@tailwindcss/postcss`). **shadcn/ui is NOT installed** (no `components.json`, no Radix deps) — the app uses hand-rolled primitives, so the files named in the brief map to equivalents:

| Requested file | Actual file | Status |
|---|---|---|
| `app/page.tsx` | `app/page.tsx` | exists (1-line proxy → `app/dashboard.tsx`) |
| `components/StrategyCard.tsx` (or equiv.) | 4 inline `<Card>` blocks in `app/dashboard.tsx` | **missing as component** — logic is inline |
| `components/GlobalInputs.tsx` (or equiv.) | inline `<Header>` (capital / price / APY / date) in `app/dashboard.tsx` | **missing as component** |
| `components/AdvisorPanel.tsx` (or equiv.) | inline “SMART ADVISOR” + “EXIT SIGNALS” in `app/dashboard.tsx` | **missing as component** |
| `app/globals.css` | `app/globals.css` | exists — v3 syntax in a v4 project |
| `tailwind.config.ts` | `tailwind.config.ts` | exists — **not loaded by Tailwind v4** |

---

## Asset checklist (per file)

| Rule | `page.tsx` / `dashboard.tsx` | `globals.css` | `tailwind.config.ts` |
|---|---|---|---|
| 1. Spacing (no arbitrary px) | ❌ `max-w-[1500px]`; minified file; internal `p-3/p-4` ok | ❌ `8px 9px`, `3px 7px`, `5px`, `24px`, `10px`, `.12em`, `#5e6ad233` | ✅ no px |
| 2. Grid (4-card matrix) | ❌ `grid md:grid-cols-2`, no `2xl:grid-cols-4`, no `w-full`, no `h-full` | n/a | n/a |
| 3. Alignment drift | ❌ stat cols `3` vs `4`; `Exposure` Stat inside input row | n/a | n/a |
| 4. Overflow | ❌ fixed `grid-cols-4` in header + stats on mobile; no `min-w-0`; table squashes | ❌ `.bar`/`.needle` fixed px | n/a |
| 5. Typography | ❌ ad-hoc `.mono` instead of `font-mono tabular-nums`; KPI values inherit 13px; `(r%)` not mono | ❌ `.label`/`.kpi` custom, `.12em` tracking, hard-coded stacks | ❌ no `fontFamily` tokens |
| 6. Border/shadow | ❌ `tr border-b` leaves double bottom line; nested `border-l-2` + bordered card | ❌ focus adds box-shadow ring; `.tooltip` dead | ❌ non-canonical names |

---

## VIOLATIONS REPORT

1. **[P0] Tailwind config is dead — the custom color theme never compiles.** This is a v4 project (`tailwindcss@4.3.3` + `@tailwindcss/postcss`), but `globals.css` uses v3 `@tailwind base/components/utilities` and `tailwind.config.ts` is never referenced (`@config` / `@theme` absent). Verified: the built CSS contains **none** of `0B0E11`, `12161C`, `262D37`, `5E6AD2`, `2EBD85`, `F6465D`, `F59E0B`, `38BDF8` (only `#667085` survives via a plain-CSS `.label`). Every utility (`text-sub`, `text-ink`, `text-accent`, `text-success`, `bg-elevated`, `bg-accent/20`, `bg-success/10`, `border-line`, …) is a silent no-op → status colors, accents, zebra headers and tinted cells are missing; text collapses to one flat `#EAECEF`. No theme can be “enforced” until this is fixed.

2. **[P1] Rule 1 — ad-hoc px values.** `max-w-[1500px]` (header + main); CSS litter: `.field { padding:8px 9px; border-radius:5px }`, `.pill { padding:3px 7px }`, `.bar { height:5px }`, `.kpi { font-size:24px }`, `.label { font-size:10px; letter-spacing:.12em }`, focus `box-shadow:0 0 0 2px #5e6ad233`. Nothing uses the Tailwind scale as a system.

3. **[P1] Rule 2 — 4-card matrix is not a matrix.** Wrapper is `grid md:grid-cols-2 gap-4`: never 1-col → 2-col → 4-col, no `w-full`, no `2xl` tier. Cards are four inline `<Card>` blocks (not `<StrategyCard variant>`), contents differ in length, no `h-full`/`items-stretch` guarantee → **unequal heights**, ragged bottom edge.

4. **[P1] Rule 3 — alignment drift.** Loop card stats = `grid-cols-4`, YT/LP stats = `grid-cols-3`, airdrop = `grid-cols-4`; the “Exposure” `Stat` sits **inside the input row** of the YT card (stat mixed with fields → broken row baseline); global header inputs hard-code `grid-cols-4`; KPI values carry no size class (`.kpi` CSS exists but is unused) → headline values render at inherited 13px with no hierarchy and no aligned baseline.

5. **[P1] Rule 4 — overflow on narrow viewports.** At 375px the header input row (`grid-cols-4`) and card stat rows (`grid-cols-3/4`) compress to ~75px cells → input suffix labels collide, KPI values clip (e.g. `$123,456` at 13px mono in a 75px cell). Long `money()` values have no `min-w-0`/`truncate` guard; scenario `<table>` has no min width so cells squash; EXIT SIGNALS rows are `flex justify-between` with non-wrapping right-hand text → mobile overflow; 11px `.state` lines (dilution break-even) wrap awkwardly at card boundaries.

6. **[P1] Rule 5 — typography fragmentation.** Numeric displays rely on a custom `.mono` class in 4 places, but not everywhere: table percent spans `<span className="text-xs">({r}%)</span>` are Inter; `{p.min}–{p.max}%` and `T+{days} DAYS` are ad hoc; KPI headline values should be `text-2xl md:text-3xl font-semibold` but are unstyled; body `13px` and micro-labels `10px/.12em` are hard-coded CSS, not tokens (`text-[10px] uppercase tracking-widest text-secondary font-medium`); `.label` is reused for headers, kpi labels and badges → inconsistent scale.

7. **[P1] Rule 6 — border/shadow confusion.** `.card` correctly uses a border, but `.field`, `.pill`, `.ghost`, `.state` (border-l) all stack `#3A4350` borders inside the card’s `#262D37` border with no hierarchy; `input:focus` adds a box-shadow ring (shadow on a nested bordered element); table rows use `border-b border-line` including the last row → **double line** against the card’s bottom border; `.tooltip` (dotted) defined but never used.

8. **[P2] Non-canonical token names.** Config exposes `line/strong/ink/sub/muted` instead of the required `default/strong/primary/secondary/muted`; `muted` (#667085) already fulfills `text-muted`, but `text-sub`/`text-ink`/`border-line` leak naming drift; two similar label colors (`sub`, `muted`) are used interchangeably.

9. **[P2] No font tokens.** `fontFamily.sans/mono` are absent from config → Tailwind’s `font-sans`/`font-mono` resolve to system defaults; Inter/JetBrains Mono only exist via hard-coded CSS. `font-mono tabular-nums` (the mandated combo) is therefore not applied by the utility system.

10. **[P2] Structural.** `app/page.tsx` and `app/dashboard.tsx` are minified 1-line files (unreadable); the “strategies” array is computed but never rendered (dead code); a `CircleHelp` icon renders with no tooltip/`aria-label`; no `components/` directory exists at all; no shadcn/ui primitives.

11. **[P3] Dead CSS / hygiene.** `.kpi` and `.tooltip` rules are unused; `.btn`/`.ghost`/`.pill`/`.state` custom classes duplicate what utilities should do; `content: ['./app/**/*']` in config would miss `components/**` classes the moment components are extracted.

---

## Fix plan (Step 2 + 3)

- Migrate `globals.css` to Tailwind v4 (`@import "tailwindcss"`), define tokens via `@theme` + a wired config (`@config`) and delete ad-hoc px rules.
- Canonical tokens: `base #0B0E11`, `surface #12161C`, `elevated #1B2129`, `default #262D37`, `strong #3A4350`, `primary #EAECEF`, `secondary #A8B3BF`, `muted #667085`, `accent #5E6AD2`, `success #2EBD85`, `danger #F6465D`, `warning #F59E0B`, `info #38BDF8`; `font-sans` = Inter, `font-mono` = JetBrains Mono.
- Extract `components/StrategyCard.tsx` (variant API), `components/GlobalInputs.tsx`, `components/AdvisorPanel.tsx`, shared primitives, and the exact 4-card grid `grid-cols-1 lg:grid-cols-2 2xl:grid-cols-4 gap-4 w-full`.
- All numeric displays → `font-mono tabular-nums`; KPI headlines `text-2xl md:text-3xl font-semibold`; micro-labels `text-[10px] uppercase tracking-widest text-secondary font-medium`; scale-only spacing (`p-4 md:p-5`, `gap-4`, `gap-2`, `space-y-3`).
- Fix mobile overflow (2-col internal grids at small widths, `min-w-0`, `truncate`, `min-w-max` table, card `h-full`), remove double borders, unify alignment.

---

## Step 2 + 3 verification (post-refactor)

**Foundation (fixed the P0):**
- `globals.css` migrated to Tailwind v4 (`@import 'tailwindcss'` + `@config`), ad-hoc px rules (`.mono/.label/.card/.field/.pill/.state/.kpi/.bar/.needle/.tooltip/.btn/.ghost`) deleted — all replaced by tokens/utilities.
- `tailwind.config.ts` now canonical: `base/surface/elevated`, `default/strong`, `primary/secondary/muted`, `accent/success/danger/warning/info`, `fontFamily.sans` (Inter) + `fontFamily.mono` (JetBrains Mono). Confirmed in compiled CSS: `#2ebd85`, `#0b0e11`, `#12161c`, `#262d37`, `#eaecEF`, `#a8b3bf`, `#1b2129`, `#3a4350`, `#f6465d`, `#f59e0b`, `#5e6ad2`; utilities `.text-primary/secondary`, `.bg-elevated`, `.text-success`, `.tabular-nums`, `.font-mono`, `.max-w-matrix` all compile.
- `package.json` → `"type": "module"`, `postcss.config.js` → `postcss.config.mjs` (build warning eliminated).

**Components (extracted, logic untouched):**
- `components/GlobalInputs.tsx` — sticky global bar (Capital / Underlying / Base APY / Airdrop date / Save).
- `components/StrategyCard.tsx` — `variant` API (`looping | yt-direct | lp | airdrop-sim`); all four math engines moved verbatim.
- `components/AdvisorPanel.tsx` — Smart Advisor + Exit Signals.
- `components/ScenarioMatrix.tsx`, `components/ui/{card,field,stat}.tsx`, `lib/scenario.ts` (types/defaults/money/`daysUntil`).
- `app/dashboard.tsx` — orchestration + boarding + the **exact** required structure:
  `grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-4 gap-4 w-full` with the four variants (verified in SSR output).

**Rule verification (grep-audited, no banned values):**
- No arbitrary px utilities except the two spec-mandated `text-[10px]` / `text-[13px]`; spacing = scale only (`p-4 md:p-5`, `gap-2/3/4`, `space-y-2/3`).
- No ad-hoc hex colors outside the theme base layer; no old token names (`text-sub`, `text-ink`, `border-line`, `.mono`, …).
- All numeric displays: `font-mono tabular-nums`; KPI headlines `text-2xl md:text-3xl font-semibold`; micro-labels `text-[10px] uppercase tracking-widest text-secondary font-medium`; card titles `text-xs uppercase tracking-wider text-secondary font-semibold`.
- Overflow: cards `min-w-0`, KPI `break-words`, 2-col internal grids at <640px, table `min-w-max` + `overflow-x-auto` inside card, header wraps (`flex-wrap`), advisor rows `gap-3` + wrapping.
- Borders: card `border-default`, controls `border-strong`, last table row `last:border-b-0` (double line removed), no card shadows; only inputs use a focus ring.

**Build/run:** `npm run build` passes clean (Next 16 + TS); `next dev` serves `/` with `GET / 200` and no runtime errors.

