'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ListChecks, Loader2 } from 'lucide-react';
import { useAllMarkets } from '../../hooks/useAllMarkets';
import { useLending } from '../../hooks/useLending';
import { useMerkl } from '../../hooks/useMerkl';
import { readLocal, STORAGE_KEYS, writeLocal } from '../../lib/data/local-store';
import { defaultPtLoopSettings, isStableMarket, LOOP_TX_ENTRY, LOOP_TX_EXIT, rankPtLoops, type PtLoopSettings } from '../../lib/stable/pt-loop';
import { defaultLendingSettings, rankLending } from '../../lib/lending/rank';
import { ptOpportunity } from '../../lib/opportunity/from-market';
import { TOP_LIMIT } from '../../lib/opportunity/rank';
import { liveAt, isStableOpp } from '../../lib/merkl/filters';
import { buildContext, tokenClass } from '../../lib/merkl/vetting';
import { formatNumber, formatPercent, formatUSD } from '../../lib/utils/formatting';
import type { Opportunity } from '../../types/opportunity';
import { Collapsible } from '../ui/card';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { Empty, Segmented } from '../opportunities/parts';
import { SectionSwitch } from '../opportunities/SectionSwitch';
import { LendingRow } from '../lending/LendingOpportunities';

type Tab = 'loop' | 'all';

interface Stored {
  tab: Tab;
  s: PtLoopSettings;
}

/** Relative PT fall that reaches liquidation at leverage L: 1 − (L − 1) ÷ (L × LLTV). */
const liqDrop = (L: number, lltv: number) => (L > 1 ? Math.max(0, 1 - (L - 1) / (L * (lltv / 100))) : 1);

const usd = (x: number) => formatUSD(x, Math.abs(x) >= 100 ? 0 : 2);

function restore(): Stored {
  const saved = readLocal<Partial<Stored>>(STORAGE_KEYS.stable, {});
  const s = { ...defaultPtLoopSettings, ...(saved.s ?? {}) };
  const n = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? x : d);
  return {
    tab: saved.tab === 'all' ? 'all' : 'loop',
    s: {
      capital: n(s.capital, 1000),
      days: n(s.days, 30),
      leverage: n(s.leverage, 3),
      borrowRate: typeof s.borrowRate === 'number' && Number.isFinite(s.borrowRate) ? s.borrowRate : null,
      lltv: n(s.lltv, 86),
      minHealth: n(s.minHealth, 1.05),
      needsEarlyExit: !!s.needsEarlyExit,
      sort: s.sort === 'daily' ? 'daily' : 'total',
      txEthereum: n(s.txEthereum, 1),
      txOther: n(s.txOther, 0.05),
      loopListedOnly: !!s.loopListedOnly,
    },
  };
}

/** Dollar stablecoins (and PT markets tagged stable) only. */
const stableOpp = (o: Opportunity) => {
  const sym = o.assets.deposit[0]?.symbol;
  return !!sym && tokenClass({ symbol: sym }) === 'usd';
};

/**
 * «پیشنهادها برای استیبل‌کوین‌ها»: where a stablecoin earns the most dollars —
 * PT Loop on every stablecoin PT market with the user's own borrow rate, and
 * every other stablecoin option in the unified ranking.
 */
export default function StableSuggestions() {
  const pt = useAllMarkets();
  const lending = useLending();
  const merkl = useMerkl();
  const [st, setSt] = useState<Stored | null>(null);
  useEffect(() => setSt(restore()), []);
  useEffect(() => {
    if (st) writeLocal(STORAGE_KEYS.stable, st);
  }, [st]);
  const setS = useCallback((p: Partial<PtLoopSettings>) => setSt((x) => (x ? { ...x, s: { ...x.s, ...p } } : x)), []);

  const s = st?.s ?? defaultPtLoopSettings;
  const loops = useMemo(() => rankPtLoops(pt.markets, s), [pt.markets, s]);
  const stableMarkets = useMemo(() => pt.markets.filter((m) => !m.expired && isStableMarket(m)), [pt.markets]);
  const minute = Math.floor(merkl.now / 60) * 60;
  const all = useMemo(() => {
    const list = [
      ...(lending.feed?.opportunities ?? []).filter(stableOpp),
      ...stableMarkets.map((m) => ptOpportunity(m.protocol, m, new Date(pt.feeds[m.protocol]?.at ?? Date.now()).toISOString())),
    ];
    const f = merkl.feed;
    const mlist = f ? f.opportunities.map((o) => liveAt(o, minute)).filter((o) => o.campaigns.length > 0 && isStableOpp(o)) : [];
    const merklInput = f ? { list: mlist, ctx: buildContext(mlist, f.markets, f.marketChains, minute), gas: f.gas, stale: merkl.stale, fetchedAt: new Date(f.fetchedAt).toISOString() } : null;
    return rankLending(list, { ...defaultLendingSettings, capital: s.capital, days: Math.max(1, Math.round(s.days)), txEthereum: s.txEthereum, txOther: s.txOther, needsEarlyExit: s.needsEarlyExit }, Date.now(), merklInput);
  }, [lending.feed, stableMarkets, pt.feeds, merkl.feed, merkl.stale, minute, s]);

  if (!st) {
    return (
      <main className="grid place-items-center py-24 text-secondary" aria-busy="true">
        <Loader2 className="animate-spin" aria-label="در حال بارگذاری" />
      </main>
    );
  }
  const loading = pt.loading && lending.loading;
  const list = st.tab === 'loop' ? loops : all;
  const aside = list.ranking.aside;

  return (
    <main className="sx max-w-matrix mx-auto px-[var(--space-page-x)] py-6 flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="page-title">فرصت‌ها</h1>
        <p className="text-sm text-secondary">پیشنهادها برای استیبل‌کوین‌ها: کجا با همان مبلغ و همان مدت بیشترین سود دلاری به دست می‌آید.</p>
        <p className="text-xs text-secondary">
          <Num>{formatNumber(stableMarkets.length, 0)}</Num> بازار PT استیبل · <Num>{formatNumber((lending.feed?.opportunities ?? []).filter(stableOpp).length, 0)}</Num> فرصت وام‌دهی و خزانه‌ی استیبل
          {pt.failed.length > 0 && <span className="text-warning"> · بخشی از بازارهای PT دریافت نشد</span>}
        </p>
      </header>

      <SectionSwitch current="stable" />

      <Segmented<Tab>
        value={st.tab}
        onChange={(tab) => setSt({ ...st, tab })}
        label="نما"
        options={[
          { id: 'loop', label: 'PT Loop با نرخ وام شما' },
          { id: 'all', label: 'همه‌ی گزینه‌های استیبل' },
        ]}
      />

      <section className="sx-card p-4 grid grid-cols-1 sm:grid-cols-2 gap-3" aria-label="ورودی‌ها">
        <NumberField label="مبلغ سرمایه (آورده‌ی شما)" value={s.capital} onChange={(v) => setS({ capital: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" />
        <NumberField label="مدت" value={s.days} onChange={(v) => setS({ days: Number.isFinite(v) ? Math.min(365, Math.max(1, Math.round(v))) : 30 })} suffix="روز" />
        {st.tab === 'loop' && (
          <>
            <NumberField
              label="نرخ وام (سالانه، APY)"
              value={s.borrowRate ?? NaN}
              onChange={(v) => setS({ borrowRate: Number.isFinite(v) ? Math.max(0, v) : null })}
              suffix="٪"
              help="نرخ وام استیبل‌کوین در پلتفرمی که PT را به‌عنوان وثیقه می‌پذیرد (مثلاً Morpho یا Aave). نرخ متغیر است و برای کل دوره ثابت فرض می‌شود."
              warning={s.borrowRate === null ? 'نرخ وام را وارد کنید تا محاسبه انجام شود.' : undefined}
            />
            <NumberField
              label="اهرم"
              value={s.leverage}
              onChange={(v) => setS({ leverage: Number.isFinite(v) ? Math.max(1, v) : 3 })}
              suffix="×"
              warning={s.leverage > loops.maxSafe ? `با LLTV ${formatNumber(s.lltv, 1)}٪ و حد سلامت ${formatNumber(s.minHealth, 2)} حداکثر ${formatNumber(loops.maxSafe, 2)}× به کار می‌رود.` : undefined}
            />
            <NumberField label="LLTV بازار وام" value={s.lltv} onChange={(v) => setS({ lltv: Number.isFinite(v) ? Math.min(99, Math.max(1, v)) : 86 })} suffix="٪" help="حد لیکوییدشدن وثیقه‌ی PT در بازار وام؛ از همان پلتفرم بخوانید." />
            <NumberField label="حداقل سلامت قابل قبول (LLTV ÷ LTV)" value={s.minHealth} onChange={(v) => setS({ minHealth: Number.isFinite(v) ? Math.max(1.01, v) : 1.05 })} />
          </>
        )}
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-sm text-secondary">اگر سررسید بعد از مدت شما باشد، ممکن است پیش از سررسید پول لازم شود؟</span>
          <Segmented<'yes' | 'no'>
            value={s.needsEarlyExit ? 'yes' : 'no'}
            onChange={(v) => setS({ needsEarlyExit: v === 'yes' })}
            label="خروج پیش از سررسید"
            size="sm"
            options={[
              { id: 'no', label: 'تا سررسید نگه می‌دارم' },
              { id: 'yes', label: 'ممکن است لازم شود' },
            ]}
          />
        </div>
        {st.tab === 'loop' && (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-secondary">مرتب‌سازی</span>
              <Segmented<'total' | 'daily'>
                value={s.sort}
                onChange={(sort) => setS({ sort })}
                label="مرتب‌سازی"
                size="sm"
                options={[
                  { id: 'total', label: 'بیشترین سود دلاری' },
                  { id: 'daily', label: 'سود به‌ازای هر روز' },
                ]}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm text-secondary">بازارها</span>
              <Segmented<'all' | 'listed'>
                value={s.loopListedOnly ? 'listed' : 'all'}
                onChange={(v) => setS({ loopListedOnly: v === 'listed' })}
                label="بازارها"
                size="sm"
                options={[
                  { id: 'all', label: 'همه‌ی PTهای استیبل' },
                  { id: 'listed', label: 'فقط فهرست PT Looping پندل' },
                ]}
              />
            </div>
          </>
        )}
      </section>

      <p className="text-xs text-secondary leading-6 rounded-md bg-surface border border-default px-3 py-2">
        {st.tab === 'loop' ? (
          <>
            سود لوپ = رشد PT تا سررسید روی کل وثیقه (آورده × اهرم) − بهره‌ی وام روی بدهی (آورده × (اهرم − ۱)) − گس. سود روی آورده‌ی شماست، نه ارزش ناخالص. هر بازار تا سررسید خودش حساب می‌شود و مدت کنار هر ردیف آمده؛ مقایسه‌ی مدت‌های نابرابر را با «سود به‌ازای هر روز» ببینید. هر ردیف فرض می‌کند کل سرمایه در همان بازار است؛ سودها قابل جمع نیستند.
          </>
        ) : (
          <>همه‌ی گزینه‌های استیبل‌کوین در رتبه‌بندی یکپارچه: PT بدون اهرم، وام‌دهی، خزانه، نرخ ثابت و پاداش‌های Merkl روی استیبل‌ها، برای همان مبلغ و مدت.</>
        )}
      </p>

      {loading ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-20 rounded-lg bg-surface border border-default animate-pulse" />
          ))}
        </div>
      ) : st.tab === 'loop' && s.borrowRate === null ? (
        <Empty>نرخ وام را وارد کنید؛ بدون آن سود لوپ ساخته نمی‌شود.</Empty>
      ) : list.ranking.top.length === 0 ? (
        <Empty>برای این مبلغ، مدت و نرخ وام گزینه‌ی سودآوری پیدا نشد.</Empty>
      ) : (
        <section className="sx-card p-2 sm:p-3" aria-label="پیشنهادهای برتر">
          <h2 className="text-sm text-secondary px-1 pb-2">
            <Num>{formatNumber(list.ranking.top.length, 0)}</Num> گزینه‌ی برتر از <Num>{formatNumber(list.total, 0)}</Num> (حداکثر <Num>{formatNumber(TOP_LIMIT, 0)}</Num>)
          </h2>
          <ol className="flex flex-col divide-y divide-default">
            {list.ranking.top.map((e, i) => {
              const o = list.byKey.get(e.key);
              return o ? <LendingRow key={e.key} e={e} o={o} rank={i + 1} /> : null;
            })}
          </ol>
        </section>
      )}

      {!loading && (aside['beyond-horizon'].length > 0 || aside.unprofitable.length > 0) && (
        <Collapsible title="کنار گذاشته برای این مدت و نرخ" icon={<ListChecks size={18} aria-hidden />} badge={<Num>{formatNumber(aside['beyond-horizon'].length + aside.unprofitable.length, 0)}</Num>}>
          <ul className="flex flex-col gap-2 text-sm">
            {[...aside['beyond-horizon'].map((e) => ({ e, why: 'سررسید بعد از مدت شما (سود تا سررسید)' })), ...aside.unprofitable.map((e) => ({ e, why: 'با این نرخ وام زیان‌ده یا بی‌سود' }))].slice(0, 60).map(({ e, why }) => {
              const o = list.byKey.get(e.key);
              return o ? (
                <li key={e.key} className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate">
                    <bdi>{o.market.name}</bdi> · <span className="text-secondary">{o.protocol.name}</span>
                  </span>
                  <span className="text-xs text-secondary shrink-0">
                    {why}
                    {e.net !== null && (
                      <>
                        {' '}
                        · <Num>{usd(e.net)}</Num>
                      </>
                    )}
                  </span>
                </li>
              ) : null;
            })}
          </ul>
        </Collapsible>
      )}

      <Collapsible title="فرض‌ها و هزینه‌ها" icon={<ListChecks size={18} aria-hidden />}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NumberField label="هزینه‌ی هر تراکنش در اتریوم" value={s.txEthereum} onChange={(v) => setS({ txEthereum: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" help={`لوپ: ${formatNumber(LOOP_TX_ENTRY, 0)} تراکنش ورود و ${formatNumber(LOOP_TX_EXIT, 0)} تراکنش خروج.`} />
          <NumberField label="هزینه‌ی هر تراکنش در سایر شبکه‌ها" value={s.txOther} onChange={(v) => setS({ txOther: Number.isFinite(v) ? Math.max(0, v) : 0 })} suffix="دلار" />
        </div>
        <ul className="text-sm text-secondary leading-7 list-disc ps-5">
          <li>بازده PT همان Implied APY امروز است و برای PT خریده‌شده تا سررسید ثابت می‌ماند؛ قیمت خرید برای حجم لوپ (اثر قیمت در استخر) گزارش نمی‌شود و در «لحاظ‌نشده‌ها» می‌آید.</li>
          <li>وام به همان واحدی است که PT به آن بازخرید می‌شود؛ استیبل‌کوین در برابری فرض شده. جدا شدن از برابری ریسک جداست.</li>
          <li>نرخ وام را شما وارد می‌کنید و برای کل دوره ثابت فرض می‌شود؛ نرخ واقعی متغیر است. پذیرش PT به‌عنوان وثیقه و LLTV را در پلتفرم وام بررسی کنید.</li>
          <li>
            اهرم هرگز از حدی که LLTV و حد سلامت شما اجازه می‌دهد بالاتر نمی‌رود (اکنون <Num>{formatNumber(loops.maxSafe, 2)}×</Num>). کنار هر ردیف، افت قیمت PT تا لیکوییدشدن آمده است (<Num>{formatPercent(liqDrop(Math.min(s.leverage, loops.maxSafe), s.lltv) * 100, 1)}</Num> برای اهرم فعلی).
          </li>
        </ul>
      </Collapsible>
    </main>
  );
}
