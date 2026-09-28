'use client';

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, CloudDownload, Loader2, Search, Wifi, WifiOff } from 'lucide-react';
import protocols from '../../config/protocols.json';
import { NumberField, TextField } from '../ui/field';
import { TokenLogo } from '../ui/token-logo';
import { Num } from '../ui/num';
import { MarketPicker } from './MarketPicker';
import { useMarketData } from '../../hooks/useMarketData';
import { mergeMarketData } from '../../lib/data/market-data';
import { formatDate, formatNumber, formatPercent, parseNumberList } from '../../lib/utils/formatting';
import type { MarketListing } from '../../types/market';
import type { ProtocolId } from '../../types/protocol';
import type { ScenarioParams, ScenarioSetter } from '../../types/scenario';
import type { FieldMessages } from './messages';

interface Props {
  p: ScenarioParams;
  set: ScenarioSetter;
  replace: (next: ScenarioParams) => void;
  msg: FieldMessages;
}

const PROTOCOLS = Object.keys(protocols) as ProtocolId[];

/** Protocol + market picker, capital, and the market values (auto-filled or manual). */
export function MarketForm({ p, set, replace, msg }: Props) {
  const md = useMarketData(p.protocol);
  const [historyText, setHistoryText] = useState(p.apyHistory.map((x) => formatNumber(x, 4)).join('، '));
  const [pickerOpen, setPickerOpen] = useState(false);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const listing = md.markets.find((m) => m.id === p.marketId) ?? null;
  const activeCount = md.markets.filter((m) => !m.expired).length;

  useEffect(() => {
    setHistoryText(p.apyHistory.map((x) => formatNumber(x, 4)).join('، '));
  }, [p.apyHistory]);

  const fetchNow = async (marketId: string) => {
    if (!marketId) return;
    const res = await md.load(marketId);
    if (res) replace(mergeMarketData({ ...p, marketId }, res.market, res.history));
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Protocol */}
      <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-elevated/60 border border-default" role="radiogroup" aria-label="پروتکل">
        {PROTOCOLS.map((id) => {
          const on = p.protocol === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => !on && replace({ ...p, protocol: id, marketId: '', marketName: '', marketIcon: '', platform: '', chain: '' })}
              className={`rounded-xl py-1.5 transition-colors flex flex-col items-center ${
                on ? 'brand-gradient text-white shadow' : 'text-secondary hover:text-primary'
              }`}
            >
              <span className="text-sm font-bold">{protocols[id].name}</span>
              <span className={`text-[10px] flex items-center gap-1 ${on ? 'text-white/80' : 'text-muted'}`}>
                {protocols[id].liveData && <span className={`size-1.5 rounded-full ${on ? 'bg-white' : 'bg-success'}`} />}
                {protocols[id].chain}
              </span>
            </button>
          );
        })}
      </div>

      {/* Market */}
      {md.live && (md.markets.length > 0 || md.listState === 'loading') ? (
        <>
          <MarketTrigger p={p} listing={listing} loading={md.listState === 'loading'} count={activeCount} onOpen={() => setPickerOpen(true)} />
          <MarketPicker
            open={pickerOpen}
            onClose={closePicker}
            markets={md.markets}
            loading={md.listState === 'loading'}
            selectedId={p.marketId}
            onSelect={(id) => {
              set('marketId', id);
              fetchNow(id);
            }}
            protocolName={protocols[p.protocol].name}
            updatedAt={md.updatedAt}
          />
        </>
      ) : md.live ? (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 items-end">
          <TextField
            label="شناسه‌ی بازار"
            value={p.marketId}
            onChange={(v) => set('marketId', v)}
            placeholder={p.protocol === 'pendle' ? '1-0x…' : 'آدرس vault'}
            ltr
          />
          <button
            type="button"
            disabled={!p.marketId || md.state === 'loading'}
            onClick={() => fetchNow(p.marketId)}
            aria-label="دریافت داده"
            className="rounded-xl p-3 text-white brand-gradient disabled:opacity-40"
          >
            <CloudDownload size={18} />
          </button>
        </div>
      ) : (
        <TextField label="نام بازار" value={p.marketName} onChange={(v) => set('marketName', v)} placeholder="مثلاً PT-USDe" />
      )}

      <Status md={md} />

      <NumberField label="سرمایه" value={p.capital} onChange={(v) => set('capital', v)} suffix="دلار" error={msg.error('capital')} />

      <div className="grid grid-cols-2 gap-3">
        <NumberField label="قیمت PT" value={p.ptPrice} onChange={(v) => set('ptPrice', v)} error={msg.error('ptPrice')} />
        <NumberField
          label="قیمت YT"
          value={p.ytPrice}
          onChange={(v) => set('ytPrice', v)}
          error={msg.error('ytPrice')}
          warning={msg.warning('ytPrice')}
        />
        <NumberField label="بازده فعلی (APY)" value={p.baseAPY} onChange={(v) => set('baseAPY', v)} suffix="%" error={msg.error('baseAPY')} />
        <NumberField
          label="قیمت دارایی"
          value={p.underlyingPrice}
          onChange={(v) => set('underlyingPrice', v)}
          suffix="دلار"
          error={msg.error('underlyingPrice')}
        />
        <div className="col-span-2">
          <TextField label="سررسید" type="date" value={p.maturity} onChange={(v) => set('maturity', v)} error={msg.error('maturity')} />
        </div>
      </div>

      <details className="group">
        <summary className="text-sm text-secondary hover:text-primary">
          تاریخچه‌ی APY{' '}
          <span className="text-muted">
            ({p.apyHistory.length ? `${formatNumber(p.apyHistory.length, 0)} روز` : 'اختیاری'})
          </span>
        </summary>
        <textarea
          dir="ltr"
          rows={3}
          aria-label="تاریخچه‌ی APY"
          className="mt-2 w-full bg-elevated/70 border border-strong rounded-xl px-3 py-2.5 text-primary text-base num focus:border-accent"
          placeholder="8.1, 7.9, 8.3"
          value={historyText}
          onChange={(e) => setHistoryText(e.target.value)}
          onBlur={() => set('apyHistory', parseNumberList(historyText))}
        />
        {msg.warning('apyHistory') && <p className="text-xs text-warning mt-1">{msg.warning('apyHistory')}</p>}
      </details>
    </div>
  );
}

function Status({ md }: { md: ReturnType<typeof useMarketData> }) {
  if (md.state === 'loading' || md.listState === 'loading') {
    return (
      <p className="flex items-center gap-2 text-sm text-info">
        <Loader2 size={14} className="animate-spin" /> در حال دریافت…
      </p>
    );
  }
  if (md.error) {
    return (
      <p className="flex items-center gap-2 text-sm text-warning">
        <WifiOff size={14} /> {md.error}
      </p>
    );
  }
  if (md.state === 'ready' && md.last) {
    return (
      <p className="flex items-center gap-2 text-sm text-success">
        <Wifi size={14} /> داده‌ی زنده دریافت شد
        {md.last.underlyingPrice === null && <span className="text-warning">· قیمت دارایی را دستی وارد کنید</span>}
      </p>
    );
  }
  if (!md.live) return <p className="text-sm text-muted">این پروتکل داده‌ی زنده ندارد؛ مقادیر را دستی وارد کنید.</p>;
  return null;
}

/** The selected market as a tappable card; opens the picker. */
function MarketTrigger({
  p,
  listing,
  loading,
  count,
  onOpen,
}: {
  p: ScenarioParams;
  listing: MarketListing | null;
  loading: boolean;
  count: number;
  onOpen: () => void;
}) {
  const expired = listing?.expired ?? (p.marketId !== '' && new Date(p.maturity).getTime() <= Date.now());

  if (!p.marketId) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="w-full flex items-center gap-3 rounded-2xl border-2 border-dashed border-accent/50 bg-accent/5 hover:bg-accent/10 px-4 py-4 transition-colors"
      >
        <span className="grid place-items-center size-11 rounded-full brand-gradient text-white shrink-0">
          {loading ? <Loader2 size={20} className="animate-spin" /> : <Search size={20} />}
        </span>
        <span className="text-right min-w-0">
          <span className="block font-bold text-primary">انتخاب بازار</span>
          <span className="block text-sm text-muted">
            {loading ? 'در حال دریافت بازارها…' : <><Num>{formatNumber(count, 0)}</Num> بازار فعال</>}
          </span>
        </span>
      </button>
    );
  }

  const name = p.marketName || listing?.name || p.marketId;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full flex items-center gap-3 rounded-2xl border px-3 py-3 bg-elevated/50 hover:bg-elevated transition-colors ${
        expired ? 'border-danger/50' : 'border-strong'
      }`}
    >
      <TokenLogo src={p.marketIcon || listing?.icon} name={name} size={44} />
      <span className="min-w-0 flex-1 text-right">
        <span className="block font-bold text-primary truncate" dir="ltr">
          {name}
        </span>
        <span className="block text-xs text-muted truncate">
          {[p.platform || listing?.platform, p.chain || listing?.chain].filter(Boolean).join(' · ')}
        </span>
        <span className={`block text-xs ${expired ? 'text-danger font-medium' : 'text-secondary'}`}>
          {expired ? 'منقضی شده — بازار دیگری انتخاب کنید' : `سررسید ${formatDate(p.maturity)}`}
        </span>
      </span>
      {listing && !expired && (
        <span className="text-left shrink-0">
          <span className="block font-extrabold text-primary">
            <Num>{formatPercent(listing.impliedAPY, 2)}</Num>
          </span>
          <span className="block text-[11px] text-muted">نرخ ثابت</span>
        </span>
      )}
      <ChevronDown size={18} className="text-muted shrink-0" />
    </button>
  );
}
