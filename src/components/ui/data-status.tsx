'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useOnline } from '../../hooks/useOnline';
import { formatAgo, formatDateTime } from '../../lib/utils/formatting';

/** Data older than this is labelled «قدیمی» even if the last request succeeded. */
export const FRESH_MS = 15 * 60_000;

export type Freshness = 'live' | 'stale' | 'offline' | 'none';

/** Freshness from the receive time, a failed-refresh flag and connectivity — separate from origin. */
export function freshness(fetchedAt: number | null, stale: boolean, online: boolean, now = Date.now()): Freshness {
  if (fetchedAt === null) return online ? 'none' : 'offline';
  if (!online) return 'offline';
  if (stale || now - fetchedAt > FRESH_MS) return 'stale';
  return 'live';
}

const LOOK: Record<Freshness, { dot: string; text: string; label: string }> = {
  live: { dot: 'bg-success', text: 'text-secondary', label: 'به‌روز' },
  stale: { dot: 'bg-warning', text: 'text-warning', label: 'قدیمی' },
  offline: { dot: 'bg-danger', text: 'text-danger', label: 'آفلاین — داده‌ی ذخیره‌شده' },
  none: { dot: 'bg-muted', text: 'text-muted', label: 'بدون داده' },
};

const toMs = (x: number | string | null | undefined) => (x === null || x === undefined ? null : typeof x === 'number' ? x : new Date(x).getTime() || null);

interface Props {
  /** Origin: from the protocol's API, or typed by hand. */
  source: 'api' | 'manual';
  /** When YieldX received the data. */
  fetchedAt?: number | string | null;
  /** When the protocol produced it, if known. */
  sourceUpdatedAt?: string | null;
  /** The last refresh failed; what is shown is the last good data. */
  stale?: boolean;
  /** Short prefix, e.g. «۷۹ بازار فعال». */
  label?: ReactNode;
  /** Name of the source, e.g. «API پندل». */
  sourceName?: string;
}

/**
 * «Where is this from and how old is it» in one line: a dot + words (never colour
 * alone). Cached data shown offline is never presented as live.
 */
export function DataStatus({ source, fetchedAt, sourceUpdatedAt, stale = false, label, sourceName }: Props) {
  const online = useOnline();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (source === 'manual') {
    return (
      <p className="text-xs text-info flex flex-wrap items-center gap-1.5">
        <span className="size-2 rounded-full bg-info" aria-hidden />
        {label && <>{label} · </>}ورود دستی — داده‌ی بازار نیست
      </p>
    );
  }
  const at = toMs(fetchedAt);
  const f = freshness(at, stale, online, now);
  const look = LOOK[f];
  return (
    <p className={`text-xs flex flex-wrap items-center gap-x-1.5 gap-y-0.5 ${look.text}`} title={at ? `دریافت: ${formatDateTime(new Date(at).toISOString())}` : undefined}>
      <span className={`size-2 rounded-full ${look.dot}`} aria-hidden />
      {label && <span className="text-secondary">{label} ·</span>}
      <span>{look.label}</span>
      {sourceName && <span className="text-secondary">· {sourceName}</span>}
      {at && <span className="text-secondary">· دریافت {formatAgo(at, now)}</span>}
      {sourceUpdatedAt && <span className="text-secondary">· به‌روزرسانی منبع {formatAgo(new Date(sourceUpdatedAt).getTime(), now)}</span>}
    </p>
  );
}
