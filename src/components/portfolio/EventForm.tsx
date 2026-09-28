'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Fee, FeeKind, PositionEvent, PositionEventType, RateSource, TokenAmount } from '../../types/position';
import { EVENT_FA, FEE_FA, RATE_FA } from '../../lib/portfolio/labels';
import { newId } from '../../lib/portfolio/portfolio';
import { formatNumber, formatUSD } from '../../lib/utils/formatting';
import { NumberField, SelectField, TextField } from '../ui/field';
import { Num } from '../ui/num';

/** Rates read "now" are only offered for events in the last two hours; older events need the historical rate. */
export const LIVE_RATE_WINDOW_MS = 2 * 60 * 60_000;

/** datetime-local value (local time) ↔ ISO. */
export const toLocalInput = (iso: string) => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const fromLocalInput = (v: string) => {
  const d = new Date(v);
  return Number.isFinite(d.getTime()) ? d.toISOString() : '';
};

export interface Draft {
  type: PositionEventType;
  at: string;
  units: number;
  cash: TokenAmount;
  assetUsd: number;
  assetUsdSource: RateSource;
  fees: Fee[];
  note: string;
}

export const emptyDraft = (type: PositionEventType, token = '', at = new Date().toISOString()): Draft => ({
  type,
  at,
  units: NaN,
  cash: { amount: NaN, token, usdRate: NaN, rateSource: 'manual' },
  assetUsd: NaN,
  assetUsdSource: 'manual',
  fees: [],
  note: '',
});

const usesUnits = (t: PositionEventType) => t === 'buy' || t === 'sell' || t === 'redeem';

const LABELS: Record<PositionEventType, { cash: string; units?: string }> = {
  buy: { cash: 'مبلغ پرداخت‌شده', units: 'تعداد توکن دریافتی (واقعی)' },
  sell: { cash: 'مبلغ دریافتی', units: 'تعداد توکن فروخته‌شده' },
  redeem: { cash: 'مبلغ دریافتی از بازخرید', units: 'تعداد PT بازخریدشده' },
  claim_yield: { cash: 'مقدار سود دریافتی' },
  claim_reward: { cash: 'مقدار پاداش دریافتی' },
  borrow: { cash: 'مقدار وام گرفته‌شده' },
  repay: { cash: 'مقدار بازپرداخت' },
};

export function validateDraft(d: Draft): string | null {
  if (!d.at) return 'تاریخ و ساعت را وارد کنید.';
  if (new Date(d.at).getTime() > Date.now() + 5 * 60_000) return 'تاریخ رویداد نمی‌تواند در آینده باشد.';
  if (usesUnits(d.type) && !(d.units > 0)) return 'تعداد توکن باید بیشتر از صفر باشد.';
  if (!(d.cash.amount >= 0) || (d.type !== 'claim_reward' && !(d.cash.amount > 0))) return 'مبلغ را وارد کنید.';
  if (!d.cash.token.trim()) return 'نماد رمزارز را وارد کنید.';
  if (d.fees.some((f) => !(f.amount >= 0) || !f.token.trim())) return 'مقدار و نماد هر کارمزد را کامل کنید.';
  return null;
}

/** Missing rates are stored as null (unknown) — the P&L then reports itself as incomplete. */
export function draftToEvent(d: Draft): PositionEvent {
  const rate = (x: number) => (Number.isFinite(x) && x > 0 ? x : null);
  return {
    id: newId(),
    type: d.type,
    at: d.at,
    units: usesUnits(d.type) ? d.units : 0,
    cash: { ...d.cash, token: d.cash.token.trim(), usdRate: rate(d.cash.usdRate ?? NaN), rateSource: rate(d.cash.usdRate ?? NaN) ? d.cash.rateSource : 'unknown' },
    assetUsd: rate(d.assetUsd),
    assetUsdSource: rate(d.assetUsd) ? d.assetUsdSource : 'unknown',
    fees: d.fees.map((f) => ({ ...f, token: f.token.trim(), usdRate: rate(f.usdRate ?? NaN), rateSource: rate(f.usdRate ?? NaN) ? f.rateSource : 'unknown' })),
    note: d.note.trim(),
  };
}

function RateInput({ label, value, source, onChange, live, liveLabel }: { label: string; value: number; source: RateSource; onChange: (v: number, s: RateSource) => void; live: number | null; liveLabel?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <NumberField label={label} value={value} onChange={(v) => onChange(v, 'manual')} suffix="$" hint="نرخ دلاری در زمان همان رویداد" />
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className={source === 'market' ? 'text-success' : Number.isFinite(value) ? 'text-info' : 'text-warning'}>
          {Number.isFinite(value) ? RATE_FA[source] : 'نرخ تاریخی نامعلوم — دستی وارد کنید'}
        </span>
        {live !== null && (
          <button type="button" className="text-accent underline" onClick={() => onChange(live, 'market')}>
            {liveLabel ?? 'نرخ فعلی بازار'} <Num>{formatUSD(live, 4)}</Num>
          </button>
        )}
      </div>
    </div>
  );
}

interface Props {
  draft: Draft;
  onChange: (d: Draft) => void;
  /** Accounting asset symbol and its live USD price (offered only for recent events). */
  assetSymbol: string;
  liveAssetUsd: number | null;
  /** Allowed types; one entry hides the selector. */
  types: PositionEventType[];
}

export function EventFields({ draft: d, onChange, assetSymbol, liveAssetUsd, types }: Props) {
  const set = (p: Partial<Draft>) => onChange({ ...d, ...p });
  const recent = Date.now() - new Date(d.at).getTime() <= LIVE_RATE_WINDOW_MS;
  const live = recent && liveAssetUsd !== null && liveAssetUsd > 0 ? liveAssetUsd : null;
  const tokenIsAsset = !!assetSymbol && d.cash.token.trim().toLowerCase() === assetSymbol.toLowerCase();
  const labels = LABELS[d.type];

  const setFee = (i: number, p: Partial<Fee>) => set({ fees: d.fees.map((f, j) => (j === i ? { ...f, ...p } : f)) });

  return (
    <div className="flex flex-col gap-3">
      {types.length > 1 && (
        <SelectField label="نوع رویداد" value={d.type} onChange={(type) => set({ type })} options={types.map((t) => ({ value: t, label: EVENT_FA[t] }))} />
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="min-w-0">
          <label className="text-sm text-secondary block mb-1.5">تاریخ و ساعت</label>
          <input
            type="datetime-local"
            dir="ltr"
            value={toLocalInput(d.at)}
            max={toLocalInput(new Date().toISOString())}
            onChange={(e) => set({ at: fromLocalInput(e.target.value) })}
            className="w-full bg-elevated/70 border border-strong rounded-xl px-3 py-2.5 text-primary text-base"
          />
        </div>
        {labels.units && <NumberField label={labels.units} value={d.units} onChange={(units) => set({ units })} />}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <NumberField label={labels.cash} value={d.cash.amount} onChange={(amount) => set({ cash: { ...d.cash, amount } })} />
        <TextField label="رمزارز" value={d.cash.token} onChange={(token) => set({ cash: { ...d.cash, token } })} placeholder={assetSymbol || 'USDC'} ltr />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <RateInput
          label={`نرخ دلاری ${d.cash.token || 'رمزارز'}`}
          value={d.cash.usdRate ?? NaN}
          source={d.cash.rateSource}
          onChange={(usdRate, rateSource) => set({ cash: { ...d.cash, usdRate, rateSource }, ...(tokenIsAsset ? { assetUsd: usdRate, assetUsdSource: rateSource } : {}) })}
          live={tokenIsAsset ? live : null}
        />
        <RateInput
          label={`نرخ دلاری دارایی پایه ${assetSymbol ? `(${assetSymbol})` : ''}`}
          value={d.assetUsd}
          source={d.assetUsdSource}
          onChange={(assetUsd, assetUsdSource) => set({ assetUsd, assetUsdSource })}
          live={live}
        />
      </div>
      {Number.isFinite(d.cash.amount) && Number.isFinite(d.cash.usdRate ?? NaN) && (
        <p className="text-xs text-secondary">
          ارزش دلاری: <Num>{formatUSD(d.cash.amount * (d.cash.usdRate ?? NaN))}</Num>
          {usesUnits(d.type) && d.units > 0 && Number.isFinite(d.assetUsd) && (
            <>
              {' '}
              · قیمت مؤثر هر توکن: <Num>{formatNumber((d.cash.amount * (d.cash.usdRate ?? NaN)) / d.assetUsd / d.units, 6)}</Num> {assetSymbol || 'واحد دارایی'}
            </>
          )}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-secondary">کارمزدها</span>
          <button
            type="button"
            className="flex items-center gap-1 text-sm text-accent"
            onClick={() => set({ fees: [...d.fees, { kind: 'network', amount: NaN, token: '', usdRate: NaN, rateSource: 'manual', included: false }] })}
          >
            <Plus size={14} /> افزودن کارمزد
          </button>
        </div>
        {d.fees.map((f, i) => (
          <div key={i} className="rounded-xl border border-default p-3 flex flex-col gap-2">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <SelectField<FeeKind> label="نوع" value={f.kind} onChange={(kind) => setFee(i, { kind })} options={(['network', 'trade', 'other'] as const).map((k) => ({ value: k, label: FEE_FA[k] }))} />
              <NumberField label="مقدار" value={f.amount} onChange={(amount) => setFee(i, { amount })} />
              <TextField label="رمزارز" value={f.token} onChange={(token) => setFee(i, { token })} placeholder="ETH" ltr />
              <NumberField label="نرخ دلاری" value={f.usdRate ?? NaN} onChange={(usdRate) => setFee(i, { usdRate, rateSource: 'manual' })} suffix="$" />
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-start gap-2 text-xs text-secondary">
                <input type="checkbox" checked={f.included} onChange={(e) => setFee(i, { included: e.target.checked })} className="mt-0.5" />
                <span>داخل مبلغ بالا حساب شده (مثلاً کارمزد سواپی که از توکن دریافتی کم شده)؛ دوباره از سود کم نشود</span>
              </label>
              <button type="button" aria-label="حذف کارمزد" className="p-1 text-danger" onClick={() => set({ fees: d.fees.filter((_, j) => j !== i) })}>
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <TextField label="یادداشت (اختیاری)" value={d.note} onChange={(note) => set({ note })} placeholder="مثلاً هش تراکنش" />
    </div>
  );
}

/** Self-contained "add an event" form for the position page. */
export function EventForm({ types, assetSymbol, liveAssetUsd, defaultToken, onSubmit, onCancel }: { types: PositionEventType[]; assetSymbol: string; liveAssetUsd: number | null; defaultToken: string; onSubmit: (e: PositionEvent) => void; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(() => emptyDraft(types[0], defaultToken));
  const error = validateDraft(d);
  return (
    <div className="flex flex-col gap-3">
      <EventFields draft={d} onChange={setD} assetSymbol={assetSymbol} liveAssetUsd={liveAssetUsd} types={types} />
      {error && <p className="text-xs text-warning">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={!!error} onClick={() => onSubmit(draftToEvent(d))} className="rounded-xl brand-gradient px-4 py-2 text-sm font-bold text-white disabled:opacity-40">
          ثبت رویداد
        </button>
        <button type="button" onClick={onCancel} className="rounded-xl border border-strong px-4 py-2 text-sm text-secondary">
          انصراف
        </button>
      </div>
    </div>
  );
}
