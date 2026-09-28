'use client';

import { useEffect, useState } from 'react';
import { CloudDownload, Loader2, Wifi, WifiOff } from 'lucide-react';
import protocols from '../../config/protocols.json';
import { NumberField, SelectField, TextField } from '../ui/field';
import { useMarketData } from '../../hooks/useMarketData';
import { mergeMarketData } from '../../lib/data/market-data';
import { formatDate, formatNumber, formatPercent, parseNumberList } from '../../lib/utils/formatting';
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
  const [historyText, setHistoryText] = useState(p.apyHistory.join('، '));

  useEffect(() => {
    setHistoryText(p.apyHistory.join('، '));
  }, [p.apyHistory]);

  const fetchNow = async (marketId: string) => {
    if (!marketId) return;
    const res = await md.load(marketId);
    if (res) replace(mergeMarketData({ ...p, marketId }, res.market, res.history));
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Protocol */}
      <div className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-elevated/60 border border-default" role="radiogroup" aria-label="پروتکل">
        {PROTOCOLS.map((id) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={p.protocol === id}
            onClick={() => p.protocol !== id && replace({ ...p, protocol: id, marketId: '', marketName: '' })}
            className={`rounded-lg py-2 text-sm font-medium transition-colors ${
              p.protocol === id ? 'brand-gradient text-white shadow' : 'text-secondary hover:text-primary'
            }`}
          >
            {protocols[id].name}
          </button>
        ))}
      </div>

      {/* Market */}
      {md.live && md.markets.length > 0 ? (
        <SelectField
          label="بازار"
          value={p.marketId}
          onChange={(id) => {
            set('marketId', id);
            fetchNow(id);
          }}
          options={[
            { value: '', label: 'یک بازار انتخاب کنید' },
            ...md.markets.map((m) => ({
              value: m.id,
              label: `${m.name} · ${formatDate(m.maturity)} · ${formatPercent(m.impliedAPY, 1)}${m.hasPoints ? ' · پوینت' : ''}`,
            })),
          ]}
        />
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

      <NumberField label="سرمایه" value={p.capital} onChange={(v) => set('capital', v)} suffix="USD" error={msg.error('capital')} />

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
          suffix="USD"
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
