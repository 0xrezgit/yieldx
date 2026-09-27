# YieldX

A Persian (RTL) advisor for yield-trading protocols — Exponent, Pendle, Spectra, Sense — that turns PT/YT market data into risk-aware recommendations for four strategies: holding/looping PT, buying YT for points, CLMM liquidity, and airdrop farming.

User guide (Persian): [docs/GUIDE.fa.md](docs/GUIDE.fa.md), also served in-app at `/guide`.

## Development

```bash
npm install
npm run dev        # http://localhost:3000 → /dashboard
npm test           # unit + integration tests (vitest)
npm run typecheck
npm run build
```

## Structure

```
src/
  app/
    dashboard/              main analysis page
    history/, history/[id]  saved scenarios, re-analysed with today's date
    guide/                  in-app guide
    api/[protocol]/         GET → active markets
    api/[protocol]/[market] GET → market data (+ ?history=<days>)
    api/scenarios/          scenario CRUD (Neon)
    api/alerts/             alert-rule CRUD (Neon)
    manifest.ts, pwa-icon/  PWA manifest and generated PNG icons
  components/
    dashboard/              useDashboard (shared state) + MobileDashboard / WebDashboard
    results/                verdict, warnings, key numbers, strategies, points, APY outlook, sensitivity
    forms/, alerts/, charts/, ui/
    layout/                 AppShell (PWA + tab state), AppHeader, BottomNav
  lib/
    protocols/              adapter per protocol (ProtocolAdapter interface)
    calculators/            implied APY, PT/YT, looping, CLMM, points valuation, APY scenarios, sensitivity
    risk/                   liquidation, impermanent loss, APY trend, advisor, alerts
    analysis.ts             runs every calculator for one scenario (pure, shared by all pages)
    data/, utils/, db/
  hooks/                    useMarketData, useScenarios, useAlerts
  types/                    market, protocol, scenario
  config/                   protocols.json, thresholds.json
tests/{unit,integration}
```

### Layouts and PWA

The dashboard has two layouts over the same state (`useDashboard`):

- **Mobile / PWA (< 1024px):** bottom tab bar — «بازار» (inputs), «نتیجه» (verdict and strategies), «هشدارها» (warnings and custom alert rules), «سناریوها».
- **Web (≥ 1024px):** inputs in a sticky side panel, results in the main column.

The app is installable (`/manifest.webmanifest`, icons at `/pwa-icon/192|512`). `public/sw.js` caches pages network-first and build assets cache-first, and never caches `/api/*`, so the dashboard keeps working offline with manually entered data. The service worker registers only in production builds.

### Units

PT/YT prices are in **accounting-asset units** (PT → 1 at maturity, PT + YT ≈ 1). All APYs are percentages. USD values are dollars.

### Protocol adapters

| Protocol | Live data | Source |
|---|---|---|
| Exponent | markets, prices, APYs, points multipliers | `api.exponent.finance/markets` (no USD price, no daily history) |
| Pendle | markets on Ethereum/Arbitrum/Base/BNB, prices, APYs, liquidity, daily APY history | `api-v2.pendle.finance/core/v1` |
| Spectra, Sense | — manual entry | — |

Pendle market ids are `<chainId>-<address>`; a bare address means Ethereum mainnet. Manual adapters answer `501 manual_only`, and the UI switches to manual inputs. To add a protocol, implement `ProtocolAdapter` (extend `BaseAdapter`), register it in `src/lib/protocols/index.ts` and add it to `src/config/protocols.json`.

### Risk thresholds

All advisor and alert cut-offs (gap %, health factor, CLMM edge distance, trend slope/volatility, points buy margin, scenario probabilities) live in `src/config/thresholds.json`.

## Neon PostgreSQL persistence

Database access is server-only and reads `DATABASE_URL` from the environment. Without it, builds still succeed, `/api/scenarios` and `/api/alerts` answer HTTP 503, and the UI stores scenarios and alert rules in localStorage instead.

1. Copy `.env.example` to `.env.local` and set `DATABASE_URL` (or set it in Vercel).
2. Apply `drizzle/0000_create_scenarios.sql` and `drizzle/0001_create_alert_rules.sql`, or run `npm run db:push` against a development database.

### API

- `GET /api/:protocol` — active markets
- `GET /api/:protocol/:market?history=30` — `{ market, history }` (`history` is `null` when the protocol has none)
- `GET /api/scenarios` · `GET /api/scenarios?id=…` · `POST` · `PUT` · `DELETE ?id=…`
- `GET /api/alerts` · `POST { metric, operator: "gt"|"lt", threshold, enabled }` · `PUT` · `DELETE ?id=…`
