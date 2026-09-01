'use client';

import { useMemo } from 'react';
import { AlertTriangle, ArrowUpRight, ChevronDown, Layers, ShieldCheck, Target, TrendingUp, Zap } from 'lucide-react';
import { Card } from './ui/card';
import { Field, selectClass } from './ui/field';
import { Stat } from './ui/stat';
import { daysUntil, money, type ScenarioParams, type ScenarioSetter } from '../lib/scenario';

export type StrategyVariant = 'looping' | 'yt-direct' | 'lp' | 'airdrop-sim';

interface StrategyCardProps {
  variant: StrategyVariant;
  p: ScenarioParams;
  set: ScenarioSetter;
}

/**
 * Strategy engines preserved byte-for-byte in behavior:
 * PT/YT loop math, direct YT exposure, CLMM fee capture, airdrop ROI model.
 * Only the presentation layer was refactored.
 */
function useStrategyMath(p: ScenarioParams) {
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

  const days = daysUntil(p.airdrop);
  const yt = p.pu / p.yt;
  const vpp = (p.fdv * (p.air / 100)) / (p.points + p.ppd * days);
  const my = p.myPoints + p.ppd * days;
  const payout = (my / (p.points + p.ppd * days)) * p.fdv * (p.air / 100);
  const roi = ((payout - p.capital) / p.capital) * 100;

  return { loop, days, yt, vpp, my, payout, roi };
}

export function StrategyCard({ variant, p, set }: StrategyCardProps) {
  const m = useStrategyMath(p);

  if (variant === 'looping') {
    const { loop } = m;
    const high = loop.agg > p.threshold * 0.8;
    return (
      <Card title="PT / YT LOOPING" icon={<Layers size={13} />}>
        <div className="flex-1 space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 2xl:grid-cols-2 gap-2">
            <Field label="PT price" value={p.pt} onChange={(v) => set('pt', v)} />
            <Field label="LTV / loop" value={p.ltv} onChange={(v) => set('ltv', v)} suffix="%" />
            <Field label="Loops" value={p.loops} onChange={(v) => set('loops', v)} />
            <Field label="Borrow APY" value={p.borrow} onChange={(v) => set('borrow', v)} suffix="%" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Deployed" value={money(loop.dep)} />
            <Stat label="Debt" value={money(loop.debt)} />
            <Stat
              label="Aggregate LTV"
              value={loop.agg.toFixed(1) + '%'}
              color={high ? 'text-warning' : 'text-success'}
            />
            <Stat label="Net APY" value={loop.apy.toFixed(2) + '%'} color="text-success" />
          </div>
          <div className="space-y-2">
            <div className="flex justify-between gap-3 text-[10px] uppercase tracking-widest text-secondary font-medium">
              <span>Liquidation health</span>
              <span className="font-mono tabular-nums lowercase tracking-normal">
                {loop.agg.toFixed(1)}% / {p.threshold}%
              </span>
            </div>
            <div className="relative h-1.5 rounded-full bg-linear-to-r from-success via-warning to-danger">
              <i
                className="absolute -top-1 h-3.5 w-0.5 rounded bg-white"
                style={{ left: Math.min(100, (loop.agg / p.threshold) * 100) + '%' }}
              />
            </div>
          </div>
        </div>
        <div className="mt-auto flex items-center gap-2 text-xs text-success font-medium">
          <ShieldCheck size={13} /> SAFE · Break-even borrow{' '}
          <span className="font-mono tabular-nums">{loop.be.toFixed(2)}%</span>
        </div>
      </Card>
    );
  }

  if (variant === 'yt-direct') {
    const { yt, loop } = m;
    const overvalued = yt > 1.2;
    return (
      <Card title="DIRECT YT PURCHASE" icon={<Target size={13} />}>
        <div className="flex-1 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Field label="YT price" value={p.yt} onChange={(v) => set('yt', v)} />
            <Field label="Points multiplier" value={p.mult} onChange={(v) => set('mult', v)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Exposure" value={yt.toFixed(2) + '×'} />
            <Stat label="YT units" value={loop.total ? (p.capital / p.yt).toFixed(0) : '—'} />
            <Stat
              label="Implied APY"
              value={(p.ry * yt).toFixed(2) + '%'}
              color={overvalued ? 'text-danger' : 'text-success'}
            />
            <Stat label="YT points" value={money(p.capital * yt * p.mult)} />
          </div>
        </div>
        <div
          className={`mt-auto flex items-center gap-2 text-xs font-medium ${
            overvalued ? 'text-danger' : 'text-success'
          }`}
        >
          {overvalued ? (
            <>
              <AlertTriangle size={13} /> OVERVALUED · capital burn risk
            </>
          ) : (
            <>
              <ShieldCheck size={13} /> FAIR VALUE · monitor exposure
            </>
          )}
        </div>
      </Card>
    );
  }

  if (variant === 'lp') {
    return (
      <Card title="CLMM LIQUIDITY" icon={<TrendingUp size={13} />}>
        <div className="flex-1 space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-2 gap-2">
            <Field label="Pool fee APY" value={p.fee} onChange={(v) => set('fee', v)} suffix="%" />
            <Field label="LP multiplier" value={p.lpm} onChange={(v) => set('lpm', v)} />
            <Field label="Volatility">
              <div className="relative">
                <select
                  className={selectClass}
                  value={String(p.vol)}
                  onChange={(e) => set('vol', Number(e.target.value))}
                >
                  <option value="0">Low</option>
                  <option value="1">High</option>
                </select>
                <ChevronDown
                  size={14}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                  aria-hidden
                />
              </div>
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="LP points" value={money(p.capital * p.lpm)} />
            <Stat label="LP profit / yr" value={money((p.capital * p.fee) / 100)} />
            <Stat label="Range APY" value={`${p.min}–${p.max}%`} />
          </div>
        </div>
        <div className="mt-auto flex items-center gap-2 text-xs text-success font-medium">
          <ShieldCheck size={13} /> IN RANGE · fees accruing
          {p.vol ? ' · WIDER RANGE ADVISED' : ''}
        </div>
      </Card>
    );
  }

  // variant === 'airdrop-sim'
  const { payout, roi, vpp, my } = m;
  return (
    <Card title="YT AIRDROP ROI" icon={<Zap size={13} />}>
        <div className="flex-1 space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-2 gap-2">
            <Field label="FDV estimate" value={p.fdv} onChange={(v) => set('fdv', v)} />
            <Field label="Airdrop allocation" value={p.air} onChange={(v) => set('air', v)} suffix="%" />
            <Field label="Total points" value={p.points} onChange={(v) => set('points', v)} />
          </div>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Points / day" value={p.ppd.toFixed(0)} />
          <Stat label="Value / point" value={money(vpp)} />
          <Stat label="Est. payout" value={money(payout)} color="text-success" />
          <Stat
            label="Net ROI"
            value={roi.toFixed(1) + '%'}
            color={roi > 0 ? 'text-success' : 'text-danger'}
          />
        </div>
      </div>
      <div className="mt-auto flex items-center gap-2 text-xs text-success font-medium">
        <ArrowUpRight size={13} /> POSITIVE EXPECTED VALUE · dilution breakeven{' '}
        <span className="font-mono tabular-nums">
          {money((my * p.fdv * (p.air / 100)) / p.capital)}
        </span>
      </div>
    </Card>
  );
}
