'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowLeftRight, ChevronDown, Landmark, Plus, Trash2 } from 'lucide-react';
import type { EarnEvent, EarnEventType, EarnFamily, EarnPosition } from '../../types/earn';
import type { Opportunity } from '../../types/opportunity';
import { useLending } from '../../hooks/useLending';
import { switchAdvice, valueEarn, type EarnInputs, type EarnValuation } from '../../lib/portfolio/earn';
import { newId } from '../../lib/portfolio/portfolio';
import { buildLoops } from '../../lib/opportunity/leverage';
import { defaultLendingSettings, rankLending } from '../../lib/lending/rank';
import { networkByKey, networkByName } from '../../lib/registry/networks';
import { formatDate, formatNumber, formatPercent } from '../../lib/utils/formatting';
import { NumberField, TextField } from '../ui/field';
import { Num } from '../ui/num';
import { btn, Chip, Panel, Pnl, QualityBadge, Stat, StatGrid, Usd } from './parts';

const FAMILY_FA: Record<EarnFamily, string> = { lend: 'وام‌دهی', vault: 'خزانه', 'fixed-lend': 'نرخ ثابت', leverage: 'لوپ (اهرم)', lp: 'LP', borrow: 'وام‌گیری' };
const EVENT_FA: Record<EarnEventType, string> = { deposit: 'واریز', withdraw: 'برداشت', claim_reward: 'دریافت پاداش', borrow: 'وام گرفتن', repay: 'بازپرداخت' };
const today = () => new Date().toISOString().slice(0, 10);
const iso = (d: string) => (Number.isFinite(new Date(d).getTime()) ? new Date(d).toISOString() : new Date().toISOString());

/** Live rates for a position from the opportunity it was saved from. */
function liveFor(p: EarnPosition, byKey: Map<string, Opportunity>): EarnInputs {
  const o = p.opportunityKey ? byKey.get(p.opportunityKey) : undefined;
  if (!o) return { rate: null, borrowRate: null, assetUsd: null, debtUsd: null };
  if (o.loop) return { rate: o.loop.collateral.yield.pct + (o.loop.collateral.supplyPct ?? 0), borrowRate: o.loop.debt.side.ratePct, assetUsd: null, debtUsd: null };
  return { rate: o.rate.kind === 'quote' ? null : o.rate.value, borrowRate: o.borrow?.ratePct ?? null, assetUsd: o.book?.unitUsd ?? null, debtUsd: null };
}

function Money({ label, onAdd, needsDebt }: { label: string; onAdd: (e: EarnEvent) => void; needsDebt?: string }) {
  const [type, setType] = useState<EarnEventType>('deposit');
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState(NaN);
  const [rate, setRate] = useState(NaN);
  const [token, setToken] = useState(label);
  const [fee, setFee] = useState(0);
  const types: EarnEventType[] = needsDebt ? ['deposit', 'withdraw', 'claim_reward', 'borrow', 'repay'] : ['deposit', 'withdraw', 'claim_reward'];
  useEffect(() => setToken(type === 'borrow' || type === 'repay' ? needsDebt ?? label : label), [type, label, needsDebt]);
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end">
      <label className="flex flex-col gap-1.5 text-sm text-sx-muted">
        نوع رویداد
        <select value={type} onChange={(e) => setType(e.target.value as EarnEventType)} className="bg-elevated border border-control rounded-md px-3 min-h-11 text-primary">
          {types.map((t) => (
            <option key={t} value={t}>
              {EVENT_FA[t]}
            </option>
          ))}
        </select>
      </label>
      <TextField label="تاریخ" type="date" value={date} onChange={setDate} />
      <TextField label="توکن" value={token} onChange={setToken} ltr />
      <NumberField label="مقدار توکن" value={amount} onChange={setAmount} />
      <NumberField label="نرخ دلاری هر توکن در آن زمان" value={rate} onChange={setRate} suffix="دلار" note="خالی = نامعلوم؛ سود و زیان «برآورد ناقص» می‌شود، صفر فرض نمی‌شود." />
      <NumberField label="کارمزد جدا (گس)" value={fee} onChange={(v) => setFee(Number.isFinite(v) ? Math.max(0, v) : 0)} suffix="دلار" />
      <button
        type="button"
        className={btn.primary}
        disabled={!(amount > 0) || !token}
        onClick={() => {
          onAdd({
            id: newId(),
            type,
            at: iso(date),
            cash: { amount, token, usdRate: Number.isFinite(rate) ? rate : null, rateSource: Number.isFinite(rate) ? 'manual' : 'unknown' },
            fees: fee > 0 ? [{ amount: fee, token: 'USD', usdRate: 1, rateSource: 'manual', kind: 'network', included: false }] : [],
            note: '',
          });
          setAmount(NaN);
        }}
      >
        <Plus size={15} aria-hidden /> ثبت رویداد
      </button>
    </div>
  );
}

function Detail({ p, v, save, remove, byKey, alternatives }: { p: EarnPosition; v: EarnValuation; save: (p: EarnPosition) => void; remove: () => void; byKey: Map<string, Opportunity>; alternatives: (capital: number, days: number) => { e: import('../../types/opportunity').Estimate; o: Opportunity }[] }) {
  const [days, setDays] = useState(30);
  const advice = useMemo(() => switchAdvice(p, v, alternatives(Math.max(0, v.netValueUsd), days), days), [p, v, days, alternatives]);
  const linked = p.opportunityKey ? byKey.has(p.opportunityKey) : false;
  const set = (x: Partial<EarnPosition>) => save({ ...p, ...x });
  const now = new Date().toISOString();
  return (
    <div className="flex flex-col gap-5 pt-4 border-t border-sx-border">
      <StatGrid>
        <Stat label="ارزش فعلی" q={v.balanceQuality}>
          <Usd x={v.valueUsd} />
        </Stat>
        {v.debtUnits > 0 && (
          <Stat label="بدهی" q={v.debtQuality}>
            <Usd x={v.debtUsd} />
          </Stat>
        )}
        <Stat label="ارزش خالص پس از بدهی">
          <Usd x={v.netValueUsd} />
        </Stat>
        <Stat label="سود و زیان کل">
          <Pnl usd={v.pnlUsd} size="sm" />
        </Stat>
        <Stat label="تحقق‌یافته">
          <Usd x={v.realizedUsd} />
        </Stat>
        <Stat label="تحقق‌نیافته">
          <Usd x={v.unrealizedUsd} />
        </Stat>
        <Stat label="پاداش دریافت‌شده">
          <Usd x={v.rewardsUsd} />
        </Stat>
        <Stat label="اگر اکنون خارج شوم" hint={v.exitCostUsd === null ? 'هزینه‌ی خروج وارد نشده' : undefined}>
          {v.exitNowUsd === null ? '—' : <Usd x={v.exitNowUsd} />}
        </Stat>
      </StatGrid>

      {v.health && (
        <p className="text-sm text-sx-muted">
          نسبت بدهی به وثیقه <Num>{formatPercent(v.health.ltv * 100, 1)}</Num> از حد <Num>{formatPercent(v.health.maxLtv * 100, 1)}</Num> · سلامت <Num>{formatNumber(v.health.health, 2)}</Num>
          {v.health.health < 1.15 && <span className="text-sx-red"> — نزدیک لیکوییدشدن</span>}
        </p>
      )}
      {v.reasons.length > 0 && (
        <ul className="text-sm text-sx-muted list-disc ps-5 leading-7">
          {v.reasons.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <NumberField
          label={`موجودی فعلی در پروتکل (${p.asset.symbol})`}
          value={p.balance?.amount ?? NaN}
          onChange={(x) => set({ balance: Number.isFinite(x) ? { amount: x, at: now } : null })}
          note={p.balance ? <>خوانده‌شده در {formatDate(p.balance.at)}</> : 'از اپ پروتکل بخوانید (با بهره‌ی انباشته)؛ بدون آن ارزش برآورد می‌شود.'}
        />
        {p.debtAsset && (
          <NumberField label={`بدهی فعلی (${p.debtAsset.symbol})`} value={p.debt?.amount ?? NaN} onChange={(x) => set({ debt: Number.isFinite(x) ? { amount: x, at: now } : null })} note={p.debt ? <>خوانده‌شده در {formatDate(p.debt.at)}</> : undefined} />
        )}
        <NumberField
          label="نرخ سالانه (APY)"
          value={v.rateUsed ?? NaN}
          onChange={(x) => set({ manualRate: Number.isFinite(x) ? x : null })}
          suffix="٪"
          note={linked ? 'نرخ زنده از رتبه‌بندی؛ مقدار دستی فقط وقتی به کار می‌رود که نرخ زنده نباشد.' : 'نرخ دستی شما'}
        />
        {p.debtAsset && <NumberField label="نرخ وام (APY)" value={v.borrowRateUsed ?? NaN} onChange={(x) => set({ manualBorrowRate: Number.isFinite(x) ? x : null })} suffix="٪" />}
        <NumberField label="هزینه‌ی خروج اکنون" value={p.exitCostUsd ?? NaN} onChange={(x) => set({ exitCostUsd: Number.isFinite(x) ? Math.max(0, x) : null })} suffix="دلار" note="گس، کارمزد برداشت، اسلیپیج باز کردن اهرم؛ خالی = نامعلوم." />
        <NumberField label={`قیمت دلاری ${p.asset.symbol}`} value={p.assetUsd ?? NaN} onChange={(x) => set({ assetUsd: Number.isFinite(x) ? x : null })} suffix="دلار" note={<QualityBadge q={v.assetUsd.quality} prefix="قیمت در محاسبه" />} />
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm text-sx-muted">رویدادها</h3>
        <ul className="flex flex-col divide-y divide-sx-border text-sm">
          {[...p.events]
            .sort((a, b) => a.at.localeCompare(b.at))
            .map((e) => (
              <li key={e.id} className="py-2 flex items-center justify-between gap-3">
                <span>
                  {EVENT_FA[e.type]} · <Num>{formatNumber(e.cash.amount, 4)}</Num> <bdi dir="ltr">{e.cash.token}</bdi> · {formatDate(e.at)}
                  {e.cash.usdRate === null && <span className="text-sx-amber"> · نرخ دلاری نامعلوم</span>}
                </span>
                <button type="button" aria-label="حذف رویداد" className="tap text-sx-faint hover:text-sx-red" onClick={() => set({ events: p.events.filter((x) => x.id !== e.id) })}>
                  <Trash2 size={15} aria-hidden />
                </button>
              </li>
            ))}
        </ul>
        <Money label={p.asset.symbol} needsDebt={p.debtAsset?.symbol} onAdd={(e) => set({ events: [...p.events, e] })} />
      </div>

      <div className="sx-card p-4 flex flex-col gap-3">
        <h3 className="font-medium flex items-center gap-2">
          <ArrowLeftRight size={16} aria-hidden /> ادامه یا خروج
        </h3>
        <NumberField label="مقایسه برای" value={days} onChange={(x) => setDays(Number.isFinite(x) ? Math.min(365, Math.max(1, Math.round(x))) : 30)} suffix="روز" />
        {advice.continueUsd !== null && (
          <p className="text-sm text-sx-muted leading-7">
            ادامه با نرخ امروز: <Usd x={advice.continueUsd} />
            {advice.best && (
              <>
                {' '}
                · بهترین جایگزین برای همین مبلغ: <bdi>{advice.best.o.protocol.name}</bdi> · <bdi>{advice.best.o.market.name}</bdi> با سود خالص <Usd x={advice.best.e.net ?? NaN} />
              </>
            )}
            {advice.advantageUsd !== null && (
              <>
                {' '}
                · مزیت پس از هزینه‌ی خروج: <Usd x={advice.advantageUsd} />
              </>
            )}
            {advice.breakEvenDays !== null && (
              <>
                {' '}
                · زمان سربه‌سر <Num>{formatNumber(advice.breakEvenDays, 1)}</Num> روز
              </>
            )}
          </p>
        )}
        <p className={`text-sm font-medium ${advice.verdict === 'switch' ? 'text-sx-green' : advice.verdict === 'stay' ? 'text-sx-text' : 'text-sx-amber'}`}>
          {advice.verdict === 'switch' ? 'جابه‌جایی در این مدت به‌صرفه به نظر می‌رسد (با نرخ‌های امروز).' : advice.verdict === 'stay' ? 'ماندن در همین پوزیشن منطقی‌تر است.' : 'برای داوری داده‌ی کافی نیست.'}
        </p>
        {advice.why.length > 0 && (
          <ul className="text-xs text-sx-muted list-disc ps-5 leading-6">
            {advice.why.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
        <p className="text-xs text-sx-faint">جایگزین‌ها از رتبه‌بندی یکپارچه (Morpho، Aave V4، Midnight) برای همین مبلغ و مدت؛ پیشنهاد نیست، مقایسه با نرخ‌های امروز است.</p>
      </div>

      <button type="button" className={`${btn.ghost} self-start text-sx-red`} onClick={() => confirm('این پوزیشن حذف شود؟') && remove()}>
        <Trash2 size={15} aria-hidden /> حذف پوزیشن
      </button>
    </div>
  );
}

function AddForm({ draft, onSave, onCancel }: { draft: EarnPosition | null; onSave: (p: EarnPosition) => void; onCancel: () => void }) {
  const [family, setFamily] = useState<EarnFamily>(draft?.family ?? 'lend');
  const [protocol, setProtocol] = useState(draft?.protocol.name ?? '');
  const [chain, setChain] = useState(draft ? networkByKey(draft.chain).name : 'Ethereum');
  const [market, setMarket] = useState(draft?.market.name ?? '');
  const [asset, setAsset] = useState(draft?.asset.symbol ?? 'USDC');
  const [debt, setDebt] = useState(draft?.debtAsset?.symbol ?? '');
  const [date, setDate] = useState(today());
  const [amount, setAmount] = useState(NaN);
  const [price, setPrice] = useState(NaN);
  const [borrowed, setBorrowed] = useState(NaN);
  const [rate, setRate] = useState(NaN);
  const needsDebt = family === 'leverage' || family === 'borrow';
  const ok = protocol.trim() && asset.trim() && amount > 0 && (!needsDebt || debt.trim());
  return (
    <div className="sx-card p-4 flex flex-col gap-3">
      <h3 className="font-medium">{draft ? 'ثبت در پرتفوی از رتبه‌بندی' : 'پوزیشن جدید'}</h3>
      {draft && <p className="text-xs text-sx-muted">نرخ زنده‌ی این فرصت به پوزیشن وصل می‌شود.</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5 text-sm text-sx-muted">
          نوع
          <select value={family} onChange={(e) => setFamily(e.target.value as EarnFamily)} disabled={!!draft} className="bg-elevated border border-control rounded-md px-3 min-h-11 text-primary">
            {(Object.keys(FAMILY_FA) as EarnFamily[]).map((f) => (
              <option key={f} value={f}>
                {FAMILY_FA[f]}
              </option>
            ))}
          </select>
        </label>
        <TextField label="پروتکل" value={protocol} onChange={setProtocol} ltr />
        <TextField label="شبکه" value={chain} onChange={setChain} ltr />
        <TextField label="بازار یا خزانه" value={market} onChange={setMarket} />
        <TextField label={family === 'leverage' ? 'دارایی وثیقه' : 'دارایی'} value={asset} onChange={setAsset} ltr />
        {needsDebt && <TextField label="دارایی بدهی" value={debt} onChange={setDebt} ltr />}
        <TextField label="تاریخ ورود" type="date" value={date} onChange={setDate} />
        <NumberField label={`مقدار ${asset || 'دارایی'} واریزشده`} value={amount} onChange={setAmount} />
        <NumberField label="نرخ دلاری هر واحد در آن زمان" value={price} onChange={setPrice} suffix="دلار" note="خالی = نامعلوم؛ صفر فرض نمی‌شود." />
        {needsDebt && <NumberField label={`مقدار ${debt || 'بدهی'} وام‌گرفته`} value={borrowed} onChange={setBorrowed} />}
        {!draft && <NumberField label="نرخ سالانه (APY)، اگر بدانید" value={rate} onChange={setRate} suffix="٪" />}
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className={btn.primary}
          disabled={!ok}
          onClick={() => {
            const at = iso(date);
            const now = new Date().toISOString();
            const net = networkByName(chain);
            const base: EarnPosition = draft ?? {
              id: newId(),
              createdAt: now,
              updatedAt: now,
              family,
              protocol: { id: protocol.toLowerCase(), name: protocol, version: null },
              chain: net.key,
              market: { id: market || asset, name: market || asset, address: null },
              opportunityKey: null,
              asset: { symbol: asset, address: null },
              debtAsset: null,
              maturity: null,
              manualRate: Number.isFinite(rate) ? rate : null,
              manualBorrowRate: null,
              maxLtv: null,
              balance: null,
              debt: null,
              assetUsd: null,
              debtUsd: null,
              exitCostUsd: null,
              events: [],
              note: '',
            };
            const events: EarnEvent[] = [
              { id: newId(), type: 'deposit', at, cash: { amount, token: asset, usdRate: Number.isFinite(price) ? price : null, rateSource: Number.isFinite(price) ? 'manual' : 'unknown' }, fees: [], note: '' },
              ...(needsDebt && borrowed > 0 ? [{ id: newId(), type: 'borrow' as const, at, cash: { amount: borrowed, token: debt, usdRate: null, rateSource: 'unknown' as const }, fees: [], note: '' }] : []),
            ];
            onSave({ ...base, id: draft ? newId() : base.id, asset: { ...base.asset, symbol: asset }, debtAsset: needsDebt ? { symbol: debt, address: base.debtAsset?.address ?? null } : null, events });
          }}
        >
          ذخیره
        </button>
        <button type="button" className={btn.ghost} onClick={onCancel}>
          انصراف
        </button>
      </div>
    </div>
  );
}

/**
 * Positions beyond PT/YT: lending, vaults, fixed-rate, loops, LP and borrowing.
 * Same rules as the PT/YT part — own records, dated readings, nothing unknown set
 * to zero — and a «continue or exit» comparison against today's ranking.
 */
export function EarnSection({ earn, saveEarn, removeEarn }: { earn: EarnPosition[]; saveEarn: (p: EarnPosition) => void; removeEarn: (id: string) => void }) {
  const { feed } = useLending();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<EarnPosition | null>(null);

  // «ثبت در پرتفوی» from the ranking: /portfolio?addEarn=<json>
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('addEarn');
    if (!raw) return;
    try {
      const d = JSON.parse(raw) as EarnPosition;
      if (d && typeof d === 'object' && typeof d.family === 'string') {
        setDraft(d);
        setAdding(true);
      }
    } catch {
      /* ignore a broken link */
    }
  }, []);

  const opps = useMemo(() => {
    const list = feed?.opportunities ?? [];
    return [...list, ...buildLoops(list)];
  }, [feed]);
  const byKey = useMemo(() => new Map(opps.map((o) => [o.key, o])), [opps]);
  const alternatives = useMemo(
    () => (capital: number, days: number) => {
      const r = rankLending(feed?.opportunities ?? [], { ...defaultLendingSettings, capital, days });
      return r.ranking.top.map((e) => ({ e, o: r.byKey.get(e.key)! })).filter((x) => x.o);
    },
    [feed],
  );
  const rows = earn.map((p) => ({ p, v: valueEarn(p, liveFor(p, byKey)) }));
  const totals = rows.reduce((a, { v }) => ({ net: a.net + (Number.isFinite(v.netValueUsd) ? v.netValueUsd : 0), pnl: a.pnl + (Number.isFinite(v.pnlUsd) ? v.pnlUsd : 0), incomplete: a.incomplete + (v.incomplete ? 1 : 0) }), { net: 0, pnl: 0, incomplete: 0 });

  return (
    <Panel
      title="سپرده، خزانه، نرخ ثابت، لوپ و LP"
      icon={<Landmark size={18} aria-hidden />}
      subtitle="پوزیشن‌هایی که PT/YT نیستند. در لوپ فقط ارزش خالص پس از بدهی در جمع می‌آید."
      actions={
        <button type="button" className={btn.ghost} onClick={() => { setDraft(null); setAdding(true); }}>
          <Plus size={15} aria-hidden /> افزودن
        </button>
      }
    >
      {rows.length > 0 && (
        <StatGrid cols={3}>
          <Stat label="ارزش خالص">
            <Usd x={totals.net} />
          </Stat>
          <Stat label="سود و زیان">
            <Pnl usd={totals.pnl} size="sm" />
          </Stat>
          <Stat label="برآورد ناقص">
            <Num>{formatNumber(totals.incomplete, 0)}</Num> پوزیشن
          </Stat>
        </StatGrid>
      )}
      {adding && (
        <AddForm
          draft={draft}
          onCancel={() => setAdding(false)}
          onSave={(p) => {
            saveEarn(p);
            setAdding(false);
            setOpen(p.id);
            if (draft) window.history.replaceState(null, '', '/portfolio');
          }}
        />
      )}
      {rows.length === 0 && !adding ? (
        <p className="text-sm text-sx-muted leading-7">
          هنوز پوزیشنی ثبت نشده. از <Link href="/opportunities/ranking" className="underline underline-offset-4">رتبه‌بندی یکپارچه</Link> دکمه‌ی «ثبت در پرتفوی» را بزنید یا دستی اضافه کنید.
        </p>
      ) : (
        <ul className="flex flex-col divide-y divide-sx-border">
          {rows.map(({ p, v }) => (
            <li key={p.id} className="py-3 flex flex-col gap-2">
              <button type="button" onClick={() => setOpen(open === p.id ? null : p.id)} aria-expanded={open === p.id} className="flex items-start justify-between gap-3 text-right">
                <span className="flex flex-col gap-1 min-w-0">
                  <span className="font-medium text-sx-text">
                    <bdi dir="ltr">{p.asset.symbol}</bdi> · <bdi dir="ltr">{p.protocol.name}</bdi>
                  </span>
                  <span className="text-xs text-sx-muted">
                    {FAMILY_FA[p.family]} · {networkByKey(p.chain).nameFa} · <bdi>{p.market.name}</bdi>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {v.incomplete && <Chip tone="warning">برآورد ناقص</Chip>}
                    {v.status === 'closed' && <Chip>بسته</Chip>}
                    <QualityBadge q={v.balanceQuality} prefix="موجودی" />
                  </span>
                </span>
                <span className="flex flex-col items-end gap-1 shrink-0">
                  <Usd x={v.netValueUsd} />
                  <Pnl usd={v.pnlUsd} size="sm" word={false} />
                  <ChevronDown size={16} className={`text-sx-faint transition-transform ${open === p.id ? 'rotate-180' : ''}`} aria-hidden />
                </span>
              </button>
              {open === p.id && <Detail p={p} v={v} save={saveEarn} remove={() => removeEarn(p.id)} byKey={byKey} alternatives={alternatives} />}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
