'use client';

import { useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { Fee, FeeKind, PositionEvent, PositionEventType, RateSource, TokenAmount } from '../../types/position';
import { EVENT_FA, FEE_FA, RATE_FA } from '../../lib/portfolio/labels';
import { newId } from '../../lib/portfolio/portfolio';
import { formatDateTime, formatNumber } from '../../lib/utils/formatting';
import { formatDollar, priceDigits } from '../../lib/portfolio/format';
import { nativeToken, tokensForChain } from '../../lib/portfolio/tokens';
import { TokenSelect, useTokenPrice } from './TokenSelect';
import { NumberField, SelectField, TextField } from '../ui/field';
import { Num } from '../ui/num';
import { btn } from './parts';

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
  cash: { amount: NaN, token, usdRate: NaN, rateSource: 'unknown' },
  assetUsd: NaN,
  assetUsdSource: 'unknown',
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

export type DraftField = 'at' | 'units' | 'amount' | 'token' | 'fees';

/** Per-field errors, each saying how to fix it; empty when the draft is valid. */
export function validateDraftFields(d: Draft): Partial<Record<DraftField, string>> {
  const e: Partial<Record<DraftField, string>> = {};
  if (!d.at) e.at = 'تاریخ و ساعت تراکنش را وارد کنید.';
  else if (new Date(d.at).getTime() > Date.now() + 5 * 60_000) e.at = 'تاریخ نمی‌تواند در آینده باشد.';
  if (usesUnits(d.type) && !(d.units > 0)) e.units = 'تعداد باید بیشتر از صفر باشد.';
  if (!(d.cash.amount >= 0) || (d.type !== 'claim_reward' && !(d.cash.amount > 0))) e.amount = 'مبلغ باید بیشتر از صفر باشد.';
  if (!d.cash.token.trim()) e.token = 'ارز را انتخاب کنید یا نماد آن را بنویسید.';
  if (d.fees.some((f) => !(f.amount >= 0) || !f.token.trim())) e.fees = 'کارمزد را کامل یا حذف کنید.';
  return e;
}

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

/**
 * USD rate for one token at the event time. A listed token's rate is filled
 * automatically (live for recent events, historical otherwise) and follows token
 * and time changes — until the user types a rate, which is then never overwritten.
 */
function RateInput({ label, symbol, at, value, source, onChange, fallback }: { label: string; symbol: string; at: string; value: number; source: RateSource; onChange: (v: number, s: RateSource) => void; fallback?: { usd: number; label: string } | null }) {
  const price = useTokenPrice(symbol, at);
  const prevSymbol = useRef(symbol);

  useEffect(() => {
    if (prevSymbol.current !== symbol) {
      prevSymbol.current = symbol;
      // A rate that was filled for the previous token no longer applies.
      if (source !== 'manual' && !price) onChange(NaN, 'unknown');
    }
    if (price && source !== 'manual' && (value !== price.usd || source !== price.source)) onChange(price.usd, price.source);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- react to price/token changes only
  }, [price?.usd, price?.source, symbol]);

  return (
    <div className="flex flex-col gap-1">
      <NumberField persian label={label} value={value} onChange={(v) => onChange(v, 'manual')} suffix="دلار" hint="نرخ دلاری در زمان همان رویداد" />
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className={source === 'market' || source === 'historical' ? 'text-sx-green' : Number.isFinite(value) ? 'text-sx-blue' : 'text-sx-orange'}>
          {Number.isFinite(value) ? RATE_FA[source] : 'نرخ نامعلوم — دستی وارد کنید'}
          {price && source === 'historical' && <> ({formatDateTime(price.at)})</>}
        </span>
        {source === 'manual' && price && (
          <button type="button" className="text-sx-accent hover:underline underline-offset-4" onClick={() => onChange(price.usd, price.source)}>
            {RATE_FA[price.source]} {formatDollar(price.usd, priceDigits(price.usd))}
          </button>
        )}
        {!price && fallback && value !== fallback.usd && (
          <button type="button" className="text-sx-accent hover:underline underline-offset-4" onClick={() => onChange(fallback.usd, 'market')}>
            {fallback.label} {formatDollar(fallback.usd, priceDigits(fallback.usd))}
          </button>
        )}
      </div>
    </div>
  );
}

interface Props {
  draft: Draft;
  /** State setter: rates fill in asynchronously, so every update is applied to the latest draft. */
  onChange: Dispatch<SetStateAction<Draft>>;
  /** Accounting asset symbol and its live USD price (offered only for recent events). */
  assetSymbol: string;
  liveAssetUsd: number | null;
  /** Allowed types; one entry hides the selector. */
  types: PositionEventType[];
  /** Chain of the market — decides which tokens are offered. */
  chain: string;
  marketIcon?: string | null;
  /** Show every error (after a submit attempt), not only for touched fields. */
  showErrors?: boolean;
}

function Group({ n, title, note, children }: { n?: number; title: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-0 border-t border-sx-border pt-4 first:border-t-0 first:pt-0">
    <fieldset className="flex flex-col gap-3 min-w-0">
      <legend className="text-[15px] font-semibold text-sx-text mb-3 flex items-center gap-2">
        {n !== undefined && <span className="grid place-items-center size-6 rounded-full bg-sx-accent/15 text-sx-accent text-xs num">{formatNumber(n, 0)}</span>}
        {title}
      </legend>
      {note && <p className="text-xs leading-5 text-sx-faint -mt-1">{note}</p>}
      {children}
    </fieldset>
    </div>
  );
}

function FieldError({ msg }: { msg?: string }) {
  return msg ? (
    <p role="alert" className="text-xs text-sx-red leading-5">
      {msg}
    </p>
  ) : null;
}

export function EventFields({ draft: d, onChange, assetSymbol, liveAssetUsd, types, chain, marketIcon, showErrors = false }: Props) {
  const set = (p: Partial<Draft>) => onChange((x) => ({ ...x, ...p }));
  const [touched, setTouched] = useState<Partial<Record<DraftField, boolean>>>({});
  const touch = (f: DraftField) => setTouched((t) => (t[f] ? t : { ...t, [f]: true }));
  const errors = validateDraftFields(d);
  const err = (f: DraftField) => (showErrors || touched[f] ? errors[f] : undefined);
  const recent = Date.now() - new Date(d.at).getTime() <= LIVE_RATE_WINDOW_MS;
  const live = recent && liveAssetUsd !== null && liveAssetUsd > 0 ? { usd: liveAssetUsd, label: 'نرخ فعلی بازار' } : null;
  const tokenIsAsset = !!assetSymbol && d.cash.token.trim().toLowerCase() === assetSymbol.toLowerCase();
  const labels = LABELS[d.type];
  const tokens = useMemo(() => tokensForChain(chain, { symbol: assetSymbol, icon: marketIcon }), [chain, assetSymbol, marketIcon]);

  // Paying with the market's own asset: one rate serves both — no duplicate input.
  useEffect(() => {
    if (tokenIsAsset && d.cash.usdRate !== d.assetUsd && Number.isFinite(d.cash.usdRate ?? NaN)) onChange((x) => ({ ...x, assetUsd: x.cash.usdRate ?? NaN, assetUsdSource: x.cash.rateSource }));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- follow the payment rate only
  }, [tokenIsAsset, d.cash.usdRate, d.cash.rateSource]);

  const setFee = (i: number, p: Partial<Fee>) => onChange((x) => ({ ...x, fees: x.fees.map((f, j) => (j === i ? { ...f, ...p } : f)) }));

  return (
    <div className="flex flex-col gap-5">
      <Group n={1} title="زمان و مقدار واقعی" note="از جزئیات تراکنش">
        {types.length > 1 && <SelectField label="نوع رویداد" value={d.type} onChange={(type) => set({ type })} options={types.map((t) => ({ value: t, label: EVENT_FA[t] }))} />}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="min-w-0" onBlur={() => touch('at')}>
            <label className="text-sm block mb-1.5" htmlFor="event-at">
              تاریخ و ساعت
            </label>
            <input id="event-at" type="datetime-local" dir="ltr" value={toLocalInput(d.at)} max={toLocalInput(new Date().toISOString())} onChange={(e) => set({ at: fromLocalInput(e.target.value) })} aria-invalid={!!err('at')} className="w-full px-3 py-2.5 text-base" />
            {d.at && !err('at') && (
              <p className="text-xs text-sx-muted mt-1">
                {formatDateTime(d.at)} · <span className="text-sx-faint">زمان محلی مرورگر؛ به‌صورت UTC ذخیره می‌شود</span>
              </p>
            )}
            <FieldError msg={err('at')} />
          </div>
          {labels.units && (
            <div onBlur={() => touch('units')}>
              <NumberField persian label={labels.units} value={d.units} onChange={(units) => set({ units })} error={errors.units} forceErrors={showErrors || touched.units} />
            </div>
          )}
        </div>
      </Group>

      <Group
        n={2}
        title={d.type === 'buy' ? 'ارز پرداختی و نرخ تبدیل' : 'ارز و نرخ تبدیل'}
        note={tokenIsAsset ? `با خود ${assetSymbol} پرداخت شده؛ یک نرخ هم برای مبلغ و هم برای دارایی پایه کافی است.` : 'قیمت دلاری ارز پرداختی و دارایی پایه.'}
      >
        <div className="grid grid-cols-2 gap-3">
          <div onBlur={() => touch('amount')}>
            <NumberField persian label={labels.cash} value={d.cash.amount} onChange={(amount) => onChange((x) => ({ ...x, cash: { ...x.cash, amount } }))} error={errors.amount} forceErrors={showErrors || touched.amount} />
          </div>
          <div>
            <TokenSelect label={d.type === 'buy' ? 'رمزارز پرداختی' : 'رمزارز'} value={d.cash.token} onChange={(token) => { touch('token'); onChange((x) => ({ ...x, cash: { ...x.cash, token } })); }} tokens={tokens} />
            <FieldError msg={err('token')} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <RateInput
            label={`نرخ دلاری ${d.cash.token || 'رمزارز'}${tokenIsAsset ? ' (= دارایی پایه)' : ''}`}
            symbol={d.cash.token}
            at={d.at}
            value={d.cash.usdRate ?? NaN}
            source={d.cash.rateSource}
            onChange={(usdRate, rateSource) => onChange((x) => ({ ...x, cash: { ...x.cash, usdRate, rateSource }, ...(tokenIsAsset ? { assetUsd: usdRate, assetUsdSource: rateSource } : {}) }))}
            fallback={tokenIsAsset ? live : null}
          />
          {!tokenIsAsset && (
            <RateInput
              label={`نرخ دلاری دارایی پایه ${assetSymbol ? `(${assetSymbol})` : ''}`}
              symbol={assetSymbol}
              at={d.at}
              value={d.assetUsd}
              source={d.assetUsdSource}
              onChange={(assetUsd, assetUsdSource) => onChange((x) => ({ ...x, assetUsd, assetUsdSource }))}
              fallback={live}
            />
          )}
        </div>
        {Number.isFinite(d.cash.amount) && Number.isFinite(d.cash.usdRate ?? NaN) && (
          <p className="text-sm text-sx-muted rounded-md bg-sx-raised px-3 py-2">
            ارزش دلاری: <span className="text-sx-text">{formatDollar(d.cash.amount * (d.cash.usdRate ?? NaN))}</span>
            {usesUnits(d.type) && d.units > 0 && Number.isFinite(d.assetUsd) && (
              <>
                {' '}
                · قیمت مؤثر هر توکن: <Num>{formatNumber((d.cash.amount * (d.cash.usdRate ?? NaN)) / d.assetUsd / d.units, 6)}</Num> <bdi dir="ltr">{assetSymbol || 'واحد دارایی'}</bdi>
              </>
            )}
          </p>
        )}
      </Group>

      <Group n={3} title="کارمزدها" note="کارمزد کم‌شده از مبلغ: «داخل مبلغ»">
        {d.fees.map((f, i) => (
          <div key={i} className="rounded-lg border border-sx-border bg-sx-raised/40 p-4 flex flex-col gap-3">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <SelectField<FeeKind> label="نوع" value={f.kind} onChange={(kind) => setFee(i, { kind })} options={(['network', 'trade', 'other'] as const).map((k) => ({ value: k, label: FEE_FA[k] }))} />
              <NumberField persian label="مقدار" value={f.amount} onChange={(amount) => setFee(i, { amount })} />
              <TokenSelect label="رمزارز کارمزد" value={f.token} onChange={(token) => setFee(i, { token })} tokens={tokens} />
            </div>
            <RateInput label={`نرخ دلاری ${f.token || 'رمزارز'}`} symbol={f.token} at={d.at} value={f.usdRate ?? NaN} source={f.rateSource} onChange={(usdRate, rateSource) => setFee(i, { usdRate, rateSource })} />
            <div className="flex items-center justify-between gap-2">
              <label className="flex items-start gap-2 text-sm text-sx-muted leading-6 min-h-11">
                <input type="checkbox" checked={f.included} onChange={(e) => setFee(i, { included: e.target.checked })} className="mt-1" />
                <span>داخل مبلغ</span>
              </label>
              <button type="button" aria-label="حذف کارمزد" className="tap grid place-items-center size-10 rounded-md text-sx-faint hover:text-sx-red hover:bg-sx-red/10" onClick={() => onChange((x) => ({ ...x, fees: x.fees.filter((_, j) => j !== i) }))}>
                <Trash2 size={16} aria-hidden />
              </button>
            </div>
          </div>
        ))}
        <FieldError msg={showErrors ? errors.fees : undefined} />
        <button
          type="button"
          className="tap self-start flex items-center gap-1 text-sm text-sx-accent hover:opacity-80 min-h-10"
          onClick={() => onChange((x) => ({ ...x, fees: [...x.fees, { kind: 'network', amount: NaN, token: nativeToken(chain), usdRate: NaN, rateSource: 'unknown', included: false }] }))}
        >
          <Plus size={14} aria-hidden /> افزودن کارمزد
        </button>
      </Group>

      <Group n={4} title="جزئیات اختیاری">
        <TextField label="یادداشت" value={d.note} onChange={(note) => set({ note })} placeholder="مثلاً هش تراکنش یا لینک آن" />
      </Group>
    </div>
  );
}

/** Self-contained "add an event" form for the position page. */
export function EventForm({ types, assetSymbol, liveAssetUsd, defaultToken, chain, marketIcon, onSubmit, onCancel }: { types: PositionEventType[]; assetSymbol: string; liveAssetUsd: number | null; defaultToken: string; chain: string; marketIcon?: string | null; onSubmit: (e: PositionEvent) => void; onCancel: () => void }) {
  const [d, setD] = useState<Draft>(() => emptyDraft(types[0], defaultToken));
  const [tried, setTried] = useState(false);
  const error = validateDraft(d);
  return (
    <div className="flex flex-col gap-3">
      <EventFields draft={d} onChange={setD} assetSymbol={assetSymbol} liveAssetUsd={liveAssetUsd} types={types} chain={chain} marketIcon={marketIcon} showErrors={tried} />
      {tried && error && <p className="text-sm text-sx-red" role="alert">ثبت نشد: موارد قرمز بالا را اصلاح کنید.</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => (error ? setTried(true) : onSubmit(draftToEvent(d)))} className={btn.primary}>
          ثبت رویداد
        </button>
        <button type="button" onClick={onCancel} className={btn.ghost}>
          انصراف
        </button>
      </div>
    </div>
  );
}
