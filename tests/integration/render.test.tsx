import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
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

const cases: Record<string, Partial<ScenarioParams>> = {
  default: {},
  withHistory: { apyHistory: Array.from({ length: 40 }, (_, i) => 8 + Math.sin(i / 3) - i * 0.05) },
  invalid: { capital: 0, ptPrice: 1.5, ltv: 95 },
  outOfRange: { rangeLowerAPY: 1, rangeUpperAPY: 2, loops: 8, ltv: 84 },
  noPoints: { pointsPerDay: 0, protocol: 'spectra' },
  pendle: { protocol: 'pendle', liquidity: 100_000 },
};

function dashboard(over: Partial<ScenarioParams>): ReadyDashboard {
  const p = { ...defaultScenario(), ...over };
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
  } as ReadyDashboard;
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
      expect(html).toContain('استراتژی‌ها');
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

  it('renders the app chrome with a badge on the alerts tab', () => {
    const html = renderToString(
      <ShellContext.Provider value={shell('result')}>
        <AppHeader />
        <BottomNav />
      </ShellContext.Provider>,
    );
    expect(html).toContain('نصب اپ');
    expect(html).toContain('هشدارها');
    expect(html).toContain('۳');
  });
});
