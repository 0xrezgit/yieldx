'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import type { RateSource } from '../../types/position';
import { fetchPrices, type TokenPrice } from '../../lib/data/market-data';
import { tokenInfo, type TokenInfo } from '../../lib/portfolio/tokens';
import { TokenLogo } from '../ui/token-logo';

/** A listed token's logo, or a monogram for anything typed by hand. */
export function TokenBadge({ symbol, size = 20, fallbackLogo }: { symbol: string; size?: number; fallbackLogo?: string | null }) {
  const t = tokenInfo(symbol);
  return (
    <span className="inline-flex items-center gap-1.5 min-w-0">
      <TokenLogo src={t?.logo ?? fallbackLogo ?? null} name={symbol || '?'} size={size} />
      <span dir="ltr" className="truncate">{t?.symbol ?? symbol}</span>
    </span>
  );
}

/**
 * Searchable token picker: the chain's tokens with official symbols and logos,
 * plus any other symbol the user types.
 */
export function TokenSelect({ label, value, onChange, tokens }: { label: string; value: string; onChange: (symbol: string) => void; tokens: TokenInfo[] }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const selected = tokens.find((t) => t.symbol.toLowerCase() === value.trim().toLowerCase());
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? tokens.filter((t) => t.symbol.toLowerCase().includes(s) || t.name.toLowerCase().includes(s)) : tokens;
  }, [q, tokens]);
  const custom = q.trim() && !tokens.some((t) => t.symbol.toLowerCase() === q.trim().toLowerCase()) ? q.trim() : null;

  const pick = (s: string) => {
    onChange(s);
    setOpen(false);
    setQ('');
  };

  return (
    <div className="min-w-0 relative">
      <label htmlFor={id} className="text-sm block mb-1.5 truncate">
        {label}
      </label>
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-full h-[46px] flex items-center justify-between gap-2 bg-sx-raised border border-sx-border hover:border-[#4a4a55] rounded-md px-3 text-sx-text text-base transition-colors"
      >
        {value ? <TokenBadge symbol={value} fallbackLogo={selected?.logo} /> : <span className="text-sx-faint">انتخاب ارز</span>}
        <ChevronDown size={14} className="text-sx-muted shrink-0" aria-hidden />
      </button>
      {open && (
        <div className="absolute z-30 mt-1.5 w-full min-w-60 rounded-lg border border-sx-border bg-sx-surface sx-pop p-2 flex flex-col gap-1">
          <div className="relative">
            <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-sx-muted" aria-hidden />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (shown[0] || custom)) {
                  e.preventDefault();
                  pick(shown[0]?.symbol ?? custom!);
                }
                if (e.key === 'Escape') setOpen(false);
              }}
              placeholder="جست‌وجو یا نماد دیگر"
              aria-label="جست‌وجوی ارز"
              dir="ltr"
              className="w-full pr-8 pl-2 h-9 text-sm"
            />
          </div>
          <ul role="listbox" className="max-h-60 overflow-y-auto flex flex-col">
            {shown.map((t) => (
              <li key={t.symbol}>
                <button
                  type="button"
                  role="option"
                  aria-selected={t.symbol === selected?.symbol}
                  onClick={() => pick(t.symbol)}
                  className={`w-full flex items-center gap-2.5 rounded-md px-2 py-2 text-right hover:bg-sx-raised transition-colors ${t.symbol === selected?.symbol ? 'bg-sx-accent/15' : ''}`}
                >
                  <TokenLogo src={t.logo} name={t.symbol} size={22} />
                  <span className="font-medium text-sx-text text-sm" dir="ltr">{t.symbol}</span>
                  <span className="text-xs text-sx-muted truncate">{t.native ? 'ارز اصلی شبکه' : t.name}</span>
                </button>
              </li>
            ))}
            {custom && (
              <li>
                <button type="button" onClick={() => pick(custom)} className="w-full rounded-md px-2 py-2 text-right text-sm text-sx-accent hover:bg-sx-raised">
                  استفاده از نماد «<span dir="ltr">{custom}</span>» (بدون قیمت خودکار)
                </button>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

const cache = new Map<string, TokenPrice | null>();
const LIVE_WINDOW_MS = 2 * 60 * 60_000;

/**
 * USD price of a listed token at an event time: the live price for events in the
 * last two hours, otherwise the historical price for that moment. Null while
 * loading, for unlisted tokens, or when the price service has nothing.
 */
export function useTokenPrice(symbol: string, atIso: string): { usd: number; source: RateSource; at: string } | null {
  const t = tokenInfo(symbol);
  const atMs = new Date(atIso).getTime();
  const live = Number.isFinite(atMs) && Date.now() - atMs <= LIVE_WINDOW_MS;
  // Historical lookups are bucketed to the minute; live ones to five minutes.
  const key = t && Number.isFinite(atMs) ? `${t.symbol}|${live ? `live-${Math.floor(Date.now() / 300_000)}` : Math.floor(atMs / 60_000)}` : null;
  const [, force] = useState(0);

  useEffect(() => {
    if (!key || !t || cache.has(key)) return;
    const ctrl = new AbortController();
    fetchPrices([t.symbol], live ? undefined : atMs, ctrl.signal)
      .then((p) => {
        cache.set(key, p[t.symbol] ?? null);
        force((n) => n + 1);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) {
          cache.set(key, null);
          force((n) => n + 1);
        }
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key captures symbol and time
  }, [key]);

  const p = key ? cache.get(key) : null;
  return p ? { usd: p.usd, source: live ? 'market' : 'historical', at: p.at } : null;
}
