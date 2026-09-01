'use client';

import { Activity, Save } from 'lucide-react';
import { Field } from './ui/field';
import type { ScenarioParams, ScenarioSetter } from '../lib/scenario';

interface GlobalInputsProps {
  p: ScenarioParams;
  set: ScenarioSetter;
}

/** Sticky global input bar — capital / underlying price / base APY / airdrop date. */
export function GlobalInputs({ p, set }: GlobalInputsProps) {
  return (
    <header className="sticky top-0 z-10 bg-base/95 backdrop-blur border-b border-default">
      <div className="max-w-matrix mx-auto px-4 md:px-5 py-3 flex flex-wrap items-center gap-3 lg:gap-5">
        <div className="flex items-center gap-2 shrink-0">
          <div className="p-2 rounded-md bg-accent/20 text-accent">
            <Activity size={18} />
          </div>
          <div>
            <div className="font-semibold tracking-tight text-primary">QUANT TERMINAL</div>
            <div className="text-[10px] uppercase tracking-widest text-secondary font-medium">
              Yield &amp; Airdrop Matrix
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 flex-1 min-w-0 lg:max-w-3xl">
          <Field label="Capital" value={p.capital} onChange={(v) => set('capital', v)} suffix="USDT" />
          <Field label="Underlying price" value={p.pu} onChange={(v) => set('pu', v)} suffix="$" />
          <Field label="Base APY" value={p.ry} onChange={(v) => set('ry', v)} suffix="%" />
          <Field
            label="Airdrop date"
            type="date"
            value={p.airdrop}
            onChange={(v) => set('airdrop', v)}
          />
        </div>

        <button
          type="button"
          onClick={() => localStorage.setItem('yieldx-scenario', JSON.stringify(p))}
          className="flex items-center gap-2 shrink-0 border border-strong rounded-md px-3 py-1.5 text-secondary text-[13px] font-medium transition-colors hover:text-primary hover:border-default"
        >
          <Save size={14} /> Save scenario
        </button>
      </div>
    </header>
  );
}
