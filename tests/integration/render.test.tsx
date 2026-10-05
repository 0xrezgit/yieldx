import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { assertPersianMoney } from '../helpers/text';
import { analyzeScenario } from '../../src/lib/analysis';
import { buildInsights, buildVerdict } from '../../src/lib/risk/advisor';
import { evaluateAlerts } from '../../src/lib/risk/alerts';
import { DEFAULT_ALERT_RULES } from '../../src/hooks/useAlerts';
import { defaultScenario, type ScenarioParams } from '../../src/types/scenario';
import { fieldMessages } from '../../src/components/forms/messages';
import { ShellContext, type MobileTab } from '../../src/components/layout/AppShell';
import { MobileDashboard } from '../../src/components/dashboard/MobileDashboard';
import { WebDashboard } from '../../src/components/dashboard/WebDashboard';
import type { ReadyDashboard } from '../../src/components/dashboard/useDashboard';
import { BottomNav } from '../../src/components/layout/BottomNav';
import { AppHeader } from '../../src/components/layout/AppHeader';

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: () => {} }),
}));

const LIVE_META = { source: 'api' as const, fetchedAt: new Date().toISOString(), sourceUpdatedAt: null, missing: [], manual: [], accountingSymbol: 'USDe', asset: null, historySource: 'none' as const };

const cases: Record<string, Partial<ScenarioParams>> = {
  default: {},
  unknownBase: { baseAPY: NaN, protocol: 'spectra', dataMeta: { ...LIVE_META, missing: ['baseAPY', 'apyHistory'] } },
  manual: { marketId: '', manualEntry: true, dataMeta: { ...LIVE_META, source: 'manual' } },
  withHistory: { apyHistory: Array.from({ length: 40 }, (_, i) => 8 + Math.sin(i / 3) - i * 0.05) },
  invalid: { capital: 0, ptPrice: 1.5, ltv: 95 },
  outOfRange: { rangeLowerAPY: 1, rangeUpperAPY: 2, loops: 8, ltv: 84 },
  noPoints: { pointsPerDay: 0, protocol: 'spectra' },
  pendle: { protocol: 'pendle', liquidity: 100_000, pointsStatus: 'active', pointsPerDay: 0 },
  snapshot: { pointsStatus: 'active', snapshotDate: new Date(Date.now() + 20 * 86_400_000).toISOString().slice(0, 10) },
  snapshotPassed: { pointsStatus: 'active', snapshotDate: '2020-01-01' },
  noPointsMarket: { pointsStatus: 'none', pointsPerDay: 0, platform: 'Fragmetric' },
  usdBasis: { pointsBasis: 'usd', underlyingPrice: 2500, maxExitLoss: 0 },
};

function dashboard(over: Partial<ScenarioParams>, started = true): ReadyDashboard {
  const p = { ...defaultScenario(), ...(started ? { marketId: 'test-market', marketName: 'sUSDe', chain: 'Ethereum', dataMeta: LIVE_META } : {}), ...over };
  const analysis = analyzeScenario(p);
  const insights = buildInsights(p, analysis);
  const noop = () => {};
  const alerts = { mode: 'local' as const, rules: DEFAULT_ALERT_RULES, add: async () => {}, update: async () => {}, remove: async () => {} };
  return {
    p,
    setP: noop,
    set: noop,
    analysis,
    insights,
    verdict: buildVerdict(analysis, insights),
    triggered: evaluateAlerts(DEFAULT_ALERT_RULES, analysis),
    msg: fieldMessages(analysis.validation),
    alerts,
    storageMode: 'local',
    save: { name: '', setName: noop, run: async () => {}, state: 'idle', isUpdate: false },
    reset: noop,
    setProtocol: noop,
    pickMarket: noop,
    refresh: noop,
    startManual: noop,
    md: { live: true, markets: [], listState: 'ready', listStale: false, updatedAt: Date.now(), state: 'ready', error: null, last: null, load: async () => null },
    carry: false,
    setCarry: noop,
    focus: 'auto',
    setFocus: noop,
    fromScenario: false,
  } as unknown as ReadyDashboard;
}

function shell(tab: MobileTab) {
  return { tab, setTab: () => {}, alertCount: 3, setAlertCount: () => {}, install: () => {} };
}

function assertClean(html: string) {
  const text = /.{0,120}(NaN|undefined|\[object Object\]).{0,40}/.exec(html.replace(/<[^>]+>/g, ' '));
  expect(text?.[0] ?? null).toBeNull();
  // Attributes too: a NaN width/position silently breaks layout.
  const attr = /[a-z-]+="[^"]*(NaN|undefined)[^"]*"/.exec(html);
  expect(attr?.[0] ?? null).toBeNull();
  assertPersianMoney(html);
}


/** Server-renders both layouts for several scenarios to catch runtime errors. */
describe('dashboard layouts render', () => {
  for (const [name, over] of Object.entries(cases)) {
    it(`web layout — "${name}"`, () => {
      const html = renderToString(
        <ShellContext.Provider value={shell('market')}>
          <WebDashboard d={dashboard(over)} />
        </ShellContext.Provider>,
      );
      expect(html).toContain('نتیجه‌ی نقدی تخمینی تا سررسید');
      expect(html).toContain('درباره‌ی این بازار');
      assertClean(html);
    });

    for (const tab of ['market', 'result', 'alerts'] as const) {
      it(`mobile layout, ${tab} tab — "${name}"`, () => {
        const html = renderToString(
          <ShellContext.Provider value={shell(tab)}>
            <MobileDashboard d={dashboard(over)} />
          </ShellContext.Provider>,
        );
        assertClean(html);
      });
    }
  }

  it('shows a start state, not a sample result, before a market is chosen', () => {
    for (const Layout of [WebDashboard, MobileDashboard]) {
      const html = renderToString(
        <ShellContext.Provider value={shell('result')}>
          <Layout d={dashboard({}, false)} />
        </ShellContext.Provider>,
      );
      expect(html).toContain('یک بازار انتخاب کنید');
      expect(html).not.toContain('نتیجه‌ی نقدی تخمینی تا سررسید');
      expect(html).not.toContain('پیشنهاد:');
      assertClean(html);
    }
  });

  it('renders the app chrome: three sections, «تحلیل بازار» active on its calculator /dashboard', () => {
    const html = renderToString(
      <ShellContext.Provider value={shell('result')}>
        <AppHeader />
        <BottomNav />
      </ShellContext.Provider>,
    );
    expect(html).toContain('نصب اپ');
    expect(html).toContain('تحلیل بازار');
    expect(html).toContain('پرتفوی من');
    expect(html).toContain('href="/portfolio"');
    expect(html).toContain('ابزارها');
    expect(html).toContain('href="/tools"');
    expect(html).not.toContain('فرصت‌ها');
    expect((html.match(/<li/g) ?? []).length).toBe(3);
    // The market analysis stays the active section on its sub-pages.
    expect(html.match(/aria-current="page"[^>]*>(?:(?!<\/a>)[\s\S])*تحلیل بازار/)).not.toBeNull();
  });
});
