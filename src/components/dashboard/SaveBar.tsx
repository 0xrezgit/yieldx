'use client';

import { Check, RotateCcw, Save } from 'lucide-react';
import type { DashboardState } from './useDashboard';

/** Scenario name + save + start over. */
export function SaveBar({ d }: { d: DashboardState }) {
  const { save } = d;
  return (
    <div className="flex items-center gap-2">
      <input
        value={save.name}
        onChange={(e) => save.setName(e.target.value)}
        placeholder="نام سناریو"
        aria-label="نام سناریو"
        className="min-w-0 flex-1 lg:w-48 lg:flex-none bg-elevated/70 border border-strong rounded-xl px-3 py-2 text-base focus:border-accent"
      />
      <button
        type="button"
        onClick={save.run}
        disabled={save.state === 'saving'}
        className="flex items-center gap-1.5 rounded-xl px-4 py-2 font-medium text-white brand-gradient disabled:opacity-50 shrink-0"
      >
        {save.state === 'saved' ? <Check size={16} /> : <Save size={16} />}
        {save.state === 'saved' ? 'ذخیره شد' : save.isUpdate ? 'به‌روزرسانی' : 'ذخیره'}
      </button>
      <button
        type="button"
        onClick={d.reset}
        aria-label="سناریوی جدید"
        title="سناریوی جدید"
        className="p-2.5 rounded-xl border border-strong text-secondary hover:text-primary shrink-0"
      >
        <RotateCcw size={16} />
      </button>
    </div>
  );
}
