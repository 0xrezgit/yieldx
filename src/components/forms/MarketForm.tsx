'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, Loader2, PencilLine, Search } from 'lucide-react';
import protocols from '../../config/protocols.json';
import { NumberField, SelectField, TextField } from '../ui/field';
import { AssetIdentity } from '../ui/asset-identity';
import { Num } from '../ui/num';
import { MarketPicker } from './MarketPicker';
import { AirdropForm } from './AirdropForm';
import { formatNumber, formatPercent, parseNumberList } from '../../lib/utils/formatting';
import { PROTOCOLS } from '../../lib/registry/identity';
import type { StrategyId } from '../../lib/analysis';
import type { ProtocolId } from '../../types/protocol';
import type { ScenarioParams } from '../../types/scenario';
import type { ReadyDashboard } from '../dashboard/useDashboard';
import { hasMarket } from '../dashboard/useDashboard';
import { TokenLogo } from '../ui/token-logo';

const PROTOCOL_IDS = Object.keys(protocols) as ProtocolId[];

export const STRATEGY_OPTIONS: { value: StrategyId | 'auto'; label: string }[] = [
  { value: 'auto', label: 'پیشنهاد خودکار' },
  { value: 'pt', label: 'نگهداری PT — نرخ ثابت' },
  { value: 'yt', label: 'خرید YT — بازده شناور و پوینت' },
  { value: 'loop', label: 'لوپ PT — اهرم با وام' },
  { value: 'clmm', label: 'نقدینگی CLMM' },
];

/** Where a market value came from: API, typed by the user, or not provided. */
export function fieldOrigin(p: ScenarioParams, key: string): 'api' | 'manual' | 'missing' | null {
  const m = p.dataMeta;
  if (!m) return p.manualEntry ? 'manual' : null;
  if (m.manual.includes(key) || m.source === 'manual') return 'manual';
  if (m.missing.includes(key)) return 'missing';
  return 'api';
}

const ORIGIN: Record<'api' | 'manual' | 'missing', ReactNode> = {
  api: <span className="text-secondary">از API بازار</span>,
  manual: <span className="text-info">ورود دستی</span>,
  missing: <span className="text-warning">در API نیست — دستی وارد کنید</span>,
};

/**
 * The short input form: protocol, market, capital and strategy. Market numbers and
 * expert parameters live in «تنظیمات پیشرفته», showing only what the chosen
 * strategy uses. Values the API gave are labelled; manual ones too.
 */
export function MarketForm({ d }: { d: ReadyDashboard }) {
  const { p, md, set, msg } = d;
  const [pickerOpen, setPickerOpen] = useState(false);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const listing = md.markets.find((m) => m.id === p.marketId) ?? null;
  const activeCount = md.markets.filter((m) => !m.expired).length;
  const started = hasMarket(p);
  const focus = d.focus;
  const unit = p.dataMeta?.accountingSymbol || 'دارایی پایه';

  return (
    <div className="flex flex-col gap-5">
      {/* Protocol — single choice */}
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm text-secondary mb-2">پروتکل معامله</legend>
        <div className="grid grid-cols-3 gap-1 p-1 rounded-lg bg-elevated border border-default" role="radiogroup" aria-label="پروتکل معامله">
          {PROTOCOL_IDS.map((id) => {
            const on = p.protocol === id;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => d.setProtocol(id)}
                className={`tap flex items-center justify-center gap-1.5 rounded-md min-h-10 text-sm transition-colors ${on ? 'bg-surface text-primary font-semibold ring-1 ring-accent' : 'text-secondary hover:text-primary'}`}
              >
                <TokenLogo src={PROTOCOLS[id].logo} name={PROTOCOLS[id].name} size={16} square />
                <bdi dir="ltr">{PROTOCOLS[id].name}</bdi>
              </button>
            );
          })}
        </div>
      </fieldset>

      {/* Market */}
      <div className="flex flex-col gap-2">
        <span className="text-sm text-secondary">بازار</span>
        {md.live ? (
          <MarketTrigger p={p} loading={md.listState === 'loading'} count={activeCount} impliedAPY={listing?.impliedAPY ?? null} onOpen={() => setPickerOpen(true)} />
        ) : (
          <p className="text-sm text-secondary">این پروتکل داده‌ی زنده ندارد؛ مقادیر را دستی وارد کنید.</p>
        )}
        {md.listState === 'error' && <p className="text-sm text-warning">{md.error} می‌توانید مقادیر را دستی وارد کنید.</p>}
        {md.state === 'error' && md.error && <p className="text-sm text-warning" role="alert">{md.error}</p>}
        {!started && (
          <button type="button" onClick={d.startManual} className="tap self-start inline-flex items-center gap-1.5 text-sm text-accent underline underline-offset-4">
            <PencilLine size={14} aria-hidden /> ورود دستی مقادیر بازار
          </button>
        )}
        <MarketPicker
          open={pickerOpen}
          onClose={closePicker}
          markets={md.markets}
          loading={md.listState === 'loading'}
          selectedId={p.marketId}
          onSelect={(m) => d.pickMarket(m)}
          title={`بازارهای ${PROTOCOLS[p.protocol].name}`}
          updatedAt={md.updatedAt}
          stale={md.listStale}
        />
      </div>

      <NumberField label="سرمایه" value={p.capital} onChange={(v) => set('capital', v)} suffix="دلار" error={msg.error('capital')} help="مبلغی که وارد می‌کنید، به دلار آمریکا. بین بازارها ثابت می‌ماند." />

      <SelectField<StrategyId | 'auto'>
        label="استراتژی"
        value={focus}
        onChange={d.setFocus}
        options={STRATEGY_OPTIONS.filter((o) => o.value !== 'clmm' || protocols[p.protocol].hasClmm)}
        help="«پیشنهاد خودکار» استراتژی با بیشترین نتیجه‌ی نقدی (بدون ایردراپ فرضی) پس از در نظر گرفتن ریسک را نشان می‌دهد."
      />

      {started && (
        <details className="group rounded-lg border border-default" open={!!p.manualEntry || (p.dataMeta?.missing ?? []).some((f) => f === 'underlyingPrice' || f === 'baseAPY')}>
          <summary className="tap flex items-center justify-between gap-2 px-4 min-h-12 text-[15px] font-semibold text-primary">
            تنظیمات پیشرفته
            <ChevronDown size={18} className="text-muted transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="flex flex-col gap-6 px-4 pb-5 pt-1">
            <Group title="داده‌ی بازار" note={`قیمت PT و YT بر حسب ${unit}؛ PT در سررسید ۱ ${unit} می‌شود.`}>
              <div className="grid grid-cols-2 gap-3">
                <NumberField label="قیمت PT" value={p.ptPrice} onChange={(v) => set('ptPrice', v)} error={msg.error('ptPrice')} note={originNote(p, 'ptPrice')} help={`قیمت یک PT بر حسب ${unit}؛ بین ۰ و ۱.`} />
                <NumberField label="قیمت YT" value={p.ytPrice} onChange={(v) => set('ytPrice', v)} error={msg.error('ytPrice')} warning={msg.warning('ytPrice')} note={originNote(p, 'ytPrice')} help={`قیمت یک YT بر حسب ${unit}. PT + YT ≈ ۱.`} />
                <NumberField label="بازده پایه (APY)" value={p.baseAPY} onChange={(v) => set('baseAPY', v)} suffix="%" error={msg.error('baseAPY')} warning={msg.warning('baseAPY')} forceErrors note={originNote(p, 'baseAPY')} help="بازده شناور فعلی دارایی. YT همین را دریافت می‌کند." />
                <NumberField label={`قیمت دلاری ${unit}`} value={p.underlyingPrice} onChange={(v) => set('underlyingPrice', v)} suffix="دلار" error={msg.error('underlyingPrice')} forceErrors note={originNote(p, 'underlyingPrice')} help="قیمت یک واحد دارایی پایه به دلار آمریکا. USDC و USDT هم ممکن است دقیقاً ۱ دلار نباشند." />
                <div className="col-span-2">
                  <TextField label="سررسید" type="date" value={p.maturity} onChange={(v) => set('maturity', v)} error={msg.error('maturity')} />
                </div>
              </div>
              <HistoryInput p={p} set={set} warning={msg.warning('apyHistory')} />
            </Group>

            {(focus === 'auto' || focus === 'loop') && (
              <Group title="لوپ PT (Loop)" note="نرخ وام و LLTV در API بازار نیست؛ از پلتفرم وام‌دهی بخوانید.">
                <div className="grid grid-cols-2 gap-3">
                  <NumberField label="LTV هر حلقه" value={p.ltv} onChange={(v) => set('ltv', v)} suffix="%" error={msg.error('ltv')} help="درصدی از ارزش وثیقه که در هر حلقه وام می‌گیرید." />
                  <NumberField label="تعداد حلقه" value={p.loops} onChange={(v) => set('loops', v)} error={msg.error('loops')} />
                  <NumberField label="نرخ بهره‌ی وام" value={p.borrowAPY} onChange={(v) => set('borrowAPY', v)} suffix="%" note="فرض دستی" />
                  <NumberField label="آستانه‌ی لیکوئید (LLTV)" value={p.liquidationThreshold} onChange={(v) => set('liquidationThreshold', v)} suffix="%" note="فرض دستی" help="اگر نسبت بدهی به وثیقه به این عدد برسد، موقعیت لیکوئید می‌شود." />
                </div>
              </Group>
            )}

            {protocols[p.protocol].hasClmm && (focus === 'auto' || focus === 'clmm') && (
              <Group title="نقدینگی CLMM" note="بازه بر حسب Implied APY است؛ پیش‌فرض آن حول نرخ همین بازار است.">
                <div className="grid grid-cols-2 gap-3">
                  <NumberField label="کف بازه" value={p.rangeLowerAPY} onChange={(v) => set('rangeLowerAPY', v)} suffix="%" error={msg.error('rangeLowerAPY')} />
                  <NumberField label="سقف بازه" value={p.rangeUpperAPY} onChange={(v) => set('rangeUpperAPY', v)} suffix="%" />
                  <NumberField label="APY کارمزد" value={p.feeAPY} onChange={(v) => set('feeAPY', v)} suffix="%" note="فرض دستی" />
                  <NumberField label="ضریب پوینت LP" value={p.lpMultiplier} onChange={(v) => set('lpMultiplier', v)} suffix="×" />
                </div>
              </Group>
            )}

            {(focus === 'auto' || focus === 'yt' || focus === 'clmm') && (
              <Group title="پوینت و ایردراپ — فرضی" note="این اعداد فرض شما هستند و فقط در «سناریوی فرضی ایردراپ» اثر دارند، نه در نتیجه‌ی نقدی.">
                <AirdropForm p={p} set={set} msg={msg} />
                <NumberField label="سقف ضرر قابل قبول در خروج از YT" value={p.maxExitLoss} onChange={(v) => set('maxExitLoss', v)} suffix="%" />
                <label className="flex items-start gap-2 text-sm text-secondary min-h-11">
                  <input type="checkbox" checked={d.carry} onChange={(e) => d.setCarry(e.target.checked)} className="mt-1" />
                  <span>با تعویض بازار، فرض‌های پوینت و ایردراپ همین بازار را نگه دار (پیش‌فرض: پاک می‌شوند تا به بازار دیگر نسبت داده نشوند)</span>
                </label>
              </Group>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function originNote(p: ScenarioParams, key: string): ReactNode {
  const o = fieldOrigin(p, key);
  return o ? ORIGIN[o] : undefined;
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 min-w-0">
      <legend className="text-sm font-semibold text-primary mb-1">{title}</legend>
      {note && <p className="text-xs leading-5 text-muted -mt-1">{note}</p>}
      {children}
    </fieldset>
  );
}

function HistoryInput({ p, set, warning }: { p: ScenarioParams; set: ReadyDashboard['set']; warning?: string }) {
  const [text, setText] = useState(p.apyHistory.map((x) => formatNumber(x, 4)).join('، '));
  useEffect(() => setText(p.apyHistory.map((x) => formatNumber(x, 4)).join('، ')), [p.apyHistory]);
  const origin = p.dataMeta?.historySource;
  return (
    <details className="group">
      <summary className="tap text-sm text-secondary hover:text-primary flex items-center min-h-11">
        تاریخچه‌ی APY پایه&nbsp;
        <span className="text-muted">
          ({p.apyHistory.length ? <><Num>{formatNumber(p.apyHistory.length, 0)}</Num> روز{origin === 'api' ? '، از API' : '، دستی'}</> : 'در دسترس نیست — اختیاری'})
        </span>
      </summary>
      <textarea
        dir="ltr"
        rows={3}
        aria-label="تاریخچه‌ی APY پایه، روزانه از قدیم به جدید"
        className="mt-2 w-full px-3 py-2.5 text-base num"
        placeholder="۸٫۱، ۷٫۹، ۸٫۳"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => set('apyHistory', parseNumberList(text))}
      />
      <p className="text-xs text-muted mt-1">درصدهای روزانه، از قدیم به جدید، با «،» یا فاصله جدا شوند.</p>
      {warning && <p className="text-xs text-warning mt-1">{warning}</p>}
    </details>
  );
}

/** The selected market as a button that opens the picker. */
function MarketTrigger({ p, loading, count, impliedAPY, onOpen }: { p: ScenarioParams; loading: boolean; count: number; impliedAPY: number | null; onOpen: () => void }) {
  const expired = p.marketId !== '' && new Date(p.maturity).getTime() <= Date.now();

  if (!p.marketId) {
    return (
      <button type="button" onClick={onOpen} aria-haspopup="dialog" className="w-full flex items-center gap-3 rounded-lg border border-dashed border-accent/70 hover:bg-accent/8 px-4 min-h-16 transition-colors">
        <span className="grid place-items-center size-10 rounded-full bg-brand text-white shrink-0">{loading ? <Loader2 size={18} className="animate-spin" aria-hidden /> : <Search size={18} aria-hidden />}</span>
        <span className="text-right min-w-0">
          <span className="block font-semibold text-primary">انتخاب بازار</span>
          <span className="block text-sm text-secondary">{loading ? 'در حال دریافت بازارها…' : <><Num>{formatNumber(count, 0)}</Num> بازار فعال</>}</span>
        </span>
      </button>
    );
  }

  return (
    <button type="button" onClick={onOpen} aria-haspopup="dialog" aria-label={`تغییر بازار — انتخاب فعلی ${p.marketName}`} className={`w-full flex items-center gap-3 rounded-lg border px-3 min-h-16 bg-elevated hover:border-strong transition-colors ${expired ? 'border-danger/60' : 'border-control'}`}>
      <AssetIdentity symbol={p.marketName || p.marketId} icon={p.marketIcon} chain={p.chain} protocol={p.protocol} maturity={p.maturity} size={32} className="flex-1" />
      {impliedAPY !== null && !expired && (
        <span className="text-left shrink-0">
          <Num className="block font-semibold text-primary">{formatPercent(impliedAPY, 2)}</Num>
          <span className="block text-xs text-muted">نرخ ثابت</span>
        </span>
      )}
      <ChevronDown size={18} className="text-muted shrink-0" aria-hidden />
    </button>
  );
}
