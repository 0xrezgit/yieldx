'use client';

import { ArrowUpRight, Info } from 'lucide-react';
import { Card } from './ui/card';
import { money, type ScenarioParams } from '../lib/scenario';

interface AdvisorPanelProps {
  p: ScenarioParams;
  agg: number;
  payout: number;
  breakEven: number;
}

/** Smart Advisor (mentor note + risk checks) and Exit Signals. */
export function AdvisorPanel({ p, agg, payout, breakEven }: AdvisorPanelProps) {
  const atRisk = agg > p.threshold * 0.8;

  return (
    <section className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
      <Card title="SMART ADVISOR" icon={<Info size={13} />}>
        <div className="flex-1 border-l-2 border-accent pl-3 space-y-3 text-secondary text-[13px]">
          <p>
            <b className="text-primary font-semibold">Mentor note:</b> Your current airdrop model
            projects{' '}
            <span className="text-success font-mono tabular-nums">{money(payout)}</span>. Keep
            estimates manual and revisit when the point denominator changes.
          </p>
          <p>
            {atRisk
              ? '⚠ Aggregate LTV is approaching liquidation. Reduce loops or add collateral.'
              : '✓ Loop health is within your stated liquidation threshold.'}
          </p>
          <p>
            {p.vol
              ? '⚠ High volatility: widen the CLMM range before fees pause.'
              : 'ℹ Low volatility supports a tighter range and more efficient capital.'}
          </p>
        </div>
      </Card>

      <Card title="EXIT SIGNALS" icon={<ArrowUpRight size={13} />}>
        <div className="flex-1 space-y-3 text-[13px]">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-secondary">YT sell target</span>
            <span className="text-right font-mono tabular-nums text-accent">
              {money((p.capital + 1000) / (p.capital / p.yt))}{' '}
              <small className="text-muted font-sans">price</small>
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-secondary">Loop exit</span>
            <span className={`text-right font-medium ${p.borrow > breakEven ? 'text-danger' : 'text-success'}`}>
              {p.borrow > breakEven ? '⚠ UNWIND LOOPS' : '✓ HOLD · borrow below break-even'}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-secondary">LP exit</span>
            <span className="text-right text-warning font-medium">
              ↔ Widen range or exit if repeated out-of-range
            </span>
          </div>
        </div>
      </Card>
    </section>
  );
}
