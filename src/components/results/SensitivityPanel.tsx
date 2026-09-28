'use client';

import { useMemo, useState } from 'react';
import { Grid3x3 } from 'lucide-react';
import type { ScenarioParams } from '../../types/scenario';
import { APY_SHIFTS, FDV_FACTORS, MULTIPLIER_FACTORS, sensitivityCube } from '../../lib/calculators/sensitivity';
import { formatMultiplier, formatPercent, formatUSD, formatUSDCompact } from '../../lib/utils/formatting';
import { Collapsible } from '../ui/card';
import { Num } from '../ui/num';

const BASE_FDV = FDV_FACTORS.indexOf(1);

const tone = (roi: number) =>
  roi > 20 ? 'bg-success/25 text-success' : roi > 0 ? 'bg-success/10 text-success' : roi > -20 ? 'bg-warning/12 text-warning' : 'bg-danger/15 text-danger';

/** YT result across base APY (rows) × points multiplier (columns) × FDV (chips). */
export function SensitivityPanel({ p, days }: { p: ScenarioParams; days: number }) {
  const [fdvIndex, setFdvIndex] = useState(BASE_FDV);
  const cube = useMemo(
    () =>
      sensitivityCube({
        capital: p.capital,
        underlyingPrice: p.underlyingPrice,
        ytPrice: p.ytPrice,
        daysToMaturity: days,
        baseAPY: p.baseAPY,
        pointsPerDay: p.pointsPerDay,
        ytMultiplier: p.ytMultiplier,
        fdv: p.fdv,
        allocation: p.airdropAllocation,
        totalPointsSupply: p.totalPointsSupply,
      }),
    [p, days],
  );

  return (
    <Collapsible title="اگر فرض‌ها غلط باشد" icon={<Grid3x3 size={18} />}>
      <div className="flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="FDV">
        {FDV_FACTORS.map((f, i) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={i === fdvIndex}
            onClick={() => setFdvIndex(i)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-sm border transition-colors ${
              i === fdvIndex ? 'border-accent bg-accent/20 text-primary' : 'border-strong text-secondary'
            }`}
          >
            FDV <Num>{formatUSDCompact(p.fdv * f)}</Num>
          </button>
        ))}
      </div>

      <div className="overflow-x-auto -mx-1 px-1">
        <table className="w-full min-w-max text-sm border-separate border-spacing-1">
          <thead>
            <tr className="text-xs text-muted">
              <th className="text-start font-normal px-2">APY ↓ · ضریب ←</th>
              {MULTIPLIER_FACTORS.map((m) => (
                <th key={m} className="font-normal px-2">
                  <Num>{formatMultiplier(p.ytMultiplier * m)}</Num>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cube[fdvIndex].map((row, r) => (
              <tr key={APY_SHIFTS[r]}>
                <td className="px-2 text-secondary whitespace-nowrap">
                  <Num>{formatPercent(row[0].apy, 1)}</Num>
                </td>
                {row.map((cell, c) => {
                  const current = APY_SHIFTS[r] === 0 && MULTIPLIER_FACTORS[c] === 1 && fdvIndex === BASE_FDV;
                  return (
                    <td
                      key={c}
                      className={`rounded-lg px-2 py-2 text-center font-semibold whitespace-nowrap ${tone(cell.roi)} ${
                        current ? 'ring-2 ring-accent' : ''
                      }`}
                    >
                      <Num>{formatUSD(cell.pnl, 0)}</Num>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted">نتیجه‌ی خرید YT. خانه‌ی قاب‌دار = فرض فعلی شما.</p>
    </Collapsible>
  );
}
