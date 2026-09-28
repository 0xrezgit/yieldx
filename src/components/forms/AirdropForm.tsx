'use client';

import { NumberField, SelectField, TextField } from '../ui/field';
import type { PointsBasis } from '../../types/market';
import type { ScenarioParams, ScenarioSetter } from '../../types/scenario';
import type { FieldMessages } from './messages';

/** Points program and airdrop assumptions. */
export function AirdropForm({ p, set, msg }: { p: ScenarioParams; set: ScenarioSetter; msg: FieldMessages }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <NumberField label="FDV توکن" value={p.fdv} onChange={(v) => set('fdv', v)} suffix="USD" error={msg.error('fdv')} />
      <NumberField
        label="سهم ایردراپ"
        value={p.airdropAllocation}
        onChange={(v) => set('airdropAllocation', v)}
        suffix="%"
        error={msg.error('airdropAllocation')}
      />
      <NumberField
        label="کل پوینت‌ها"
        value={p.totalPointsSupply}
        onChange={(v) => set('totalPointsSupply', v)}
        error={msg.error('totalPointsSupply')}
      />
      <NumberField label="پوینت‌های فعلی شما" value={p.existingPoints} onChange={(v) => set('existingPoints', v)} />
      <NumberField
        label="ضریب پوینت YT"
        value={p.ytMultiplier}
        onChange={(v) => set('ytMultiplier', v)}
        suffix="×"
        error={msg.error('ytMultiplier')}
      />
      <NumberField
        label="پوینت روزانه"
        value={p.pointsPerDay}
        onChange={(v) => set('pointsPerDay', v)}
        error={msg.error('pointsPerDay')}
      />
      <SelectField<PointsBasis>
        label="به ازای"
        value={p.pointsBasis}
        onChange={(v) => set('pointsBasis', v)}
        options={[
          { value: 'unit', label: 'هر واحد دارایی' },
          { value: 'usd', label: 'هر ۱ دلار' },
        ]}
      />
      <TextField label="تاریخ اسنپ‌شات" type="date" value={p.snapshotDate} onChange={(v) => set('snapshotDate', v)} />
      <div className="col-span-2">
        <TextField label="نام پوینت" value={p.pointsName} onChange={(v) => set('pointsName', v)} />
      </div>
    </div>
  );
}
