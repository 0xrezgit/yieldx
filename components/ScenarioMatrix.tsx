'use client';

import { Wallet } from 'lucide-react';
import { Card } from './ui/card';
import { money, type ScenarioParams } from '../lib/scenario';

interface ScenarioMatrixProps {
  p: ScenarioParams;
  payout: number;
}

/** FDV × dilution sensitivity matrix — data + math unchanged, layout made scroll-safe. */
export function ScenarioMatrix({ p, payout }: ScenarioMatrixProps) {
  return (
    <Card title="SCENARIO MATRIX · FDV × DILUTION" icon={<Wallet size={13} />} className="mt-4">
      <div className="flex-1 overflow-x-auto">
        <table className="w-full min-w-max text-left text-[13px]">
          <thead>
            <tr className="bg-elevated">
              <th className="px-3 py-2 text-[10px] uppercase tracking-widest text-secondary font-medium">
                FDV / dilution
              </th>
              <th className="px-3 py-2 text-[10px] uppercase tracking-widest text-secondary font-medium">
                Low · −40%
              </th>
              <th className="px-3 py-2 text-[10px] uppercase tracking-widest text-secondary font-medium">
                Mid
              </th>
              <th className="px-3 py-2 text-[10px] uppercase tracking-widest text-secondary font-medium">
                High · +40%
              </th>
            </tr>
          </thead>
          <tbody>
            {[-0.4, 0, 0.4].map((fd, i) => (
              <tr key={i} className="border-b border-default last:border-b-0">
                <td className="px-3 py-2 whitespace-nowrap font-mono tabular-nums">
                  {i === 0 ? 'BEAR' : i === 1 ? 'BASE' : 'BULL'}{' '}
                  <span className="text-muted">{money(p.fdv * (1 + fd))}</span>
                </td>
                {[-0.4, 0, 0.4].map((di, j) => {
                  const val = payout * (1 + fd) * (1 - di);
                  const r = ((val - p.capital) / p.capital) * 100;
                  return (
                    <td
                      key={j}
                      className={`px-3 py-2 whitespace-nowrap font-mono tabular-nums ${
                        r > 20
                          ? 'text-success bg-success/10'
                          : r > 0
                            ? 'text-warning bg-warning/10'
                            : 'text-danger bg-danger/10'
                      }`}
                    >
                      {money(val)} <span className="text-xs">({r.toFixed(0)}%)</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
