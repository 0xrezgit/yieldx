'use client';

import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, CircleHelp } from 'lucide-react';
import { GlobalInputs } from '../components/GlobalInputs';
import { StrategyCard } from '../components/StrategyCard';
import { AdvisorPanel } from '../components/AdvisorPanel';
import { ScenarioMatrix } from '../components/ScenarioMatrix';
import {
  daysUntil,
  defaultScenario,
  type ScenarioKey,
  type ScenarioParams,
} from '../lib/scenario';

export default function Dashboard() {
  const [p, setP] = useState<ScenarioParams>({ ...defaultScenario });
  const [onboard, setOnboard] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('yieldx-scenario');
    if (saved) setP(JSON.parse(saved));
    else setOnboard(true);
  }, []);

  const set = (key: ScenarioKey, value: ScenarioParams[ScenarioKey]) =>
    setP((x) => ({ ...x, [key]: value }));

  const days = daysUntil(p.airdrop);

  /* ------------------------------------------------------------------ */
  /* Math engines (unchanged formulas)                                  */
  /* ------------------------------------------------------------------ */
  const loop = useMemo(() => {
    const k = (p.pt / p.pu) * (p.ltv / 100);
    const dep = (p.capital * (1 - Math.pow(k, p.loops + 1))) / (1 - k);
    const debt = dep - p.capital;
    const total = dep / p.pu;
    const rev = total * p.pu * (p.ry / 100);
    const cost = debt * (p.borrow / 100);
    return {
      k,
      dep,
      debt,
      total,
      rev,
      cost,
      apy: ((rev - cost) / p.capital) * 100,
      agg: (debt / (total * p.pt)) * 100,
      be: debt ? (rev / debt) * 100 : 0,
    };
  }, [p]);

  const yt = p.pu / p.yt;
  const vpp = (p.fdv * (p.air / 100)) / (p.points + p.ppd * days);
  const my = p.myPoints + p.ppd * days;
  const payout = (my / (p.points + p.ppd * days)) * p.fdv * (p.air / 100);
  const roi = ((payout - p.capital) / p.capital) * 100;

  const strategies = [
    { name: 'PT / YT Loop', apy: loop.apy, cpp: loop.cost / (loop.total * (p.ry / 100)) },
    { name: 'Direct YT', apy: p.ry * yt, cpp: 0 },
    { name: 'CLMM Liquidity', apy: p.fee, cpp: 0 },
    { name: 'Airdrop farm', apy: roi, cpp: p.capital / my },
  ];

  return (
    <>
      <GlobalInputs p={p} set={set} />

      {onboard && (
        <div className="fixed inset-0 z-30 bg-black/70 flex items-center justify-center p-4">
          <div className="bg-surface border border-default rounded-lg max-w-md w-full p-4 md:p-5 space-y-3">
            <div className="text-[10px] uppercase tracking-widest text-accent font-medium">
              WELCOME TO QUANT TERMINAL
            </div>
            <h2 className="text-xl font-semibold text-primary">Manual entry, clear decisions.</h2>
            <p className="text-secondary text-[13px]">
              This matrix never calls an external API. Follow five simple steps to build a scenario:
            </p>
            <ol className="space-y-3 text-secondary text-[13px]">
              {[
                'Open your protocol or market dashboard.',
                'Read the current Base APY and Underlying price.',
                'Enter PT and YT prices plus your loop parameters.',
                'Add points multipliers, FDV and allocation estimates.',
                'Let the engines compare yield, risk and efficiency.',
              ].map((x, i) => (
                <li key={x} className="flex gap-3">
                  <span className="font-mono tabular-nums text-accent">0{i + 1}</span>
                  {x}
                </li>
              ))}
            </ol>
            <button
              type="button"
              onClick={() => setOnboard(false)}
              className="bg-accent hover:bg-accent/90 transition-colors text-white font-semibold rounded-md px-3 py-2 w-full flex items-center justify-center gap-2"
            >
              Start entering data <ArrowUpRight size={14} />
            </button>
          </div>
        </div>
      )}

      <main className="max-w-matrix mx-auto px-4 md:px-5 py-5">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
          <div>
            <div className="text-[10px] uppercase tracking-widest text-accent font-medium mb-2">
              MANUAL MARKET DATA / LIVE CALCULATION
            </div>
            <h1 className="text-2xl md:text-3xl font-semibold tracking-tight text-primary">
              Strategy matrix{' '}
              <span className="text-muted font-normal">· no oracle assumptions</span>
            </h1>
          </div>
          <div className="flex gap-2">
            <span className="text-[10px] uppercase tracking-widest font-medium border border-strong rounded px-1.5 py-0.5 text-success">
              ● LOCAL ONLY
            </span>
            <span className="text-[10px] uppercase tracking-widest font-medium border border-strong rounded px-1.5 py-0.5 text-muted font-mono tabular-nums">
              T+{days} DAYS
            </span>
          </div>
        </div>

        {/* 4-strategy matrix — exact required structure */}
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-4 gap-4 w-full">
          <StrategyCard variant="looping" p={p} set={set} />
          <StrategyCard variant="yt-direct" p={p} set={set} />
          <StrategyCard variant="lp" p={p} set={set} />
          <StrategyCard variant="airdrop-sim" p={p} set={set} />
        </div>

        <AdvisorPanel p={p} agg={loop.agg} payout={payout} breakEven={loop.be} />

        <ScenarioMatrix p={p} payout={payout} />

        <div className="flex items-center gap-2 text-muted mt-4 text-xs">
          <CircleHelp size={13} /> All values are estimates from your manual inputs. No external
          market data is used.
        </div>
      </main>
    </>
  );
}
