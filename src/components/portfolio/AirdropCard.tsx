'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { Gift, Link2, Plus, Trash2, Undo2 } from 'lucide-react';
import type { AirdropProgram } from '../../types/airdrop';
import type { Position } from '../../types/position';
import type { PositionView } from '../../hooks/usePortfolioView';
import { emptyProgram, pastValues, programKey, stageOf, type AirdropStage } from '../../lib/portfolio/airdrop';
import { newId } from '../../lib/portfolio/portfolio';
import { tokensForChain } from '../../lib/portfolio/tokens';
import { NETWORKS, networkByName } from '../../lib/registry/networks';
import { formatCompact, formatDate, formatDateTime, formatNumber, formatPercent, formatToken } from '../../lib/utils/formatting';
import { useCoinPrice } from '../../hooks/useCoinPrice';
import { NumberField, SelectField, TextField } from '../ui/field';
import { InlineHelp } from '../ui/inline-help';
import { Num } from '../ui/num';
import { fromLocalInput, toLocalInput } from './EventForm';
import { TokenSelect, useTokenPrice } from './TokenSelect';
import { btn, Chip, Panel, Pnl, Usd } from './parts';

const STAGE: Record<AirdropStage, { label: string; tone: 'info' | 'warning' | 'accent' | 'success' | 'muted' }> = {
  collecting: { label: 'در حال جمع‌آوری', tone: 'info' },
  pending: { label: 'منتظر توزیع', tone: 'warning' },
  received: { label: 'توکن دریافت شد', tone: 'accent' },
  selling: { label: 'در حال فروش', tone: 'accent' },
  closed: { label: 'تسویه شد', tone: 'success' },
  none: { label: 'ایردراپی داده نشد', tone: 'muted' },
};

const M = 1e6;
const nowLocal = () => new Date().toISOString();

interface Props {
  x: PositionView;
  /** Every airdrop record (for linking and last season's value). */
  programs: AirdropProgram[];
  /** All positions, to name the ones sharing a program. */
  views: PositionView[];
  saveAirdrop: (a: AirdropProgram) => void;
  removeAirdrop: (id: string) => void;
  onSavePosition: (p: Position) => void;
}

/**
 * Points → airdrop for one YT position, from estimate to settled result. One primary
 * action per stage; everything recorded is what the user read or received.
 */
export function AirdropCard({ x, programs, views, saveAirdrop, removeAirdrop, onSavePosition }: Props) {
  const { p, v } = x;
  const link = x.airdrops[0] ?? null;
  const program = link?.program ?? null;
  const stage: AirdropStage = program ? stageOf(program) : 'collecting';
  const [form, setForm] = useState<null | 'start' | 'points' | 'claim' | 'sale' | 'shares'>(null);
  const save = (a: AirdropProgram) => {
    saveAirdrop(a);
    setForm(null);
  };

  const name = program?.name || p.points.name || '';
  const past = useMemo(() => (name ? pastValues(programs, name, program?.id) : []), [programs, name, program?.id]);
  const perM = p.points.valuePerPoint * M;
  const cash = v.pnlUsd;

  return (
    <Panel
      title="ایردراپ و پوینت"
      icon={<Gift size={17} aria-hidden />}
      actions={<Chip tone={STAGE[stage].tone}>{STAGE[stage].label}</Chip>}
      subtitle={program ? <><bdi dir="ltr">{program.name}</bdi>{program.season !== null && <> · فصل <Num>{formatNumber(program.season, 0)}</Num></>}</> : undefined}
    >
      {(stage === 'collecting' || stage === 'pending') && (
        <Estimate points={v.points} finalPoints={program?.finalPoints?.amount ?? null} cashUsd={cash} perM={perM} past={past} onPerM={(val) => onSavePosition({ ...p, points: { ...p.points, valuePerPoint: val / M } })} />
      )}

      {(stage === 'received' || stage === 'selling' || stage === 'closed') && link && <Result link={link} cashUsd={cash} onManualPrice={(usd) => program && saveAirdrop({ ...program, manualPrice: { usd, at: nowLocal() } })} />}

      {stage === 'none' && program && (
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <Fig label="ایردراپ">
            <Usd x={0} />
          </Fig>
          <Fig label="نتیجه‌ی کل (فقط نقدی YT)">
            <Pnl usd={cash} size="sm" />
          </Fig>
        </dl>
      )}

      {program && program.positionIds.length > 1 && link && (
        <p className="text-sm text-sx-muted">
          سهم این پوزیشن: <Num className="text-sx-text">{formatPercent(link.share * 100, 0)}</Num> از <Num>{formatNumber(program.positionIds.length, 0)}</Num> پوزیشن{' '}
          <button type="button" className="tap text-sx-accent underline underline-offset-4" onClick={() => setForm('shares')}>
            ویرایش سهم
          </button>
        </p>
      )}

      {/* The one next step */}
      {form === null && (
        <div className="flex flex-wrap items-center gap-2">
          {!program && (
            <button type="button" className={btn.primary} onClick={() => setForm('start')}>
              <Plus size={16} aria-hidden /> شروع ثبت ایردراپ
            </button>
          )}
          {program && stage === 'collecting' && (
            <button type="button" className={btn.primary} onClick={() => setForm('points')}>
              ثبت پوینت نهایی
            </button>
          )}
          {program && stage === 'pending' && (
            <button type="button" className={btn.primary} onClick={() => setForm('claim')}>
              ثبت توکن دریافتی
            </button>
          )}
          {program && (stage === 'received' || stage === 'selling') && (
            <>
              <button type="button" className={btn.primary} onClick={() => setForm('sale')}>
                ثبت فروش
              </button>
              <button type="button" className={btn.ghost} onClick={() => setForm('claim')}>
                دریافت دیگر
              </button>
            </>
          )}
          {program && (stage === 'collecting' || stage === 'pending') && (
            <button type="button" className={btn.ghost} onClick={() => saveAirdrop({ ...program, noAirdrop: true })}>
              ایردراپی داده نشد
            </button>
          )}
          {program && stage === 'none' && (
            <button type="button" className={btn.ghost} onClick={() => saveAirdrop({ ...program, noAirdrop: false })}>
              <Undo2 size={15} aria-hidden /> بازگرداندن
            </button>
          )}
        </div>
      )}

      {form === 'start' && <StartForm p={p} programs={programs} onCancel={() => setForm(null)} onSave={save} />}
      {form === 'points' && program && <PointsForm program={program} estimate={v.points} onCancel={() => setForm(null)} onSave={save} />}
      {form === 'claim' && program && <ClaimForm program={program} chain={p.chain} onCancel={() => setForm(null)} onSave={save} />}
      {form === 'sale' && program && link && <SaleForm program={program} remaining={link.summary.remaining} onCancel={() => setForm(null)} onSave={save} />}
      {form === 'shares' && program && <SharesForm program={program} views={views} onCancel={() => setForm(null)} onSave={save} />}

      {program && <History program={program} onSave={saveAirdrop} onUnlink={() => {
        const rest = program.positionIds.filter((id) => id !== p.id);
        if (!rest.length && !program.claims.length && !program.finalPoints) removeAirdrop(program.id);
        else saveAirdrop({ ...program, positionIds: rest, shares: program.shares ? Object.fromEntries(Object.entries(program.shares).filter(([k]) => k !== p.id)) : null });
      }} />}
    </Panel>
  );
}

function Fig({ label, children, help }: { label: ReactNode; children: ReactNode; help?: ReactNode }) {
  return (
    <div className="min-w-0 flex flex-col gap-1">
      <dt className="text-xs text-sx-muted flex items-center gap-1">
        {label}
        {help}
      </dt>
      <dd className="text-[17px] text-sx-text">{children}</dd>
    </div>
  );
}

/** Before distribution: points, break-even per 1M, the assumed value (with last season's actual), three scenarios. */
function Estimate({ points, finalPoints, cashUsd, perM, past, onPerM }: { points: number; finalPoints: number | null; cashUsd: number; perM: number; past: { season: number | null; valuePerMillion: number }[]; onPerM: (v: number) => void }) {
  const pts = finalPoints ?? points;
  const breakEven = pts > 0 && Number.isFinite(cashUsd) ? (cashUsd >= 0 ? 0 : -cashUsd / (pts / M)) : NaN;
  const last = past[0];
  const below = Number.isFinite(breakEven) && perM > 0 && perM < breakEven;
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <Fig label={finalPoints !== null ? 'پوینت نهایی' : 'پوینت تخمینی'}>
          {pts > 0 ? <Num>{formatCompact(pts)}</Num> : <span className="text-sx-faint">—</span>}
          {finalPoints !== null && points > 0 && (
            <span className="block text-xs text-sx-faint">
              تخمین <Num>{formatCompact(points)}</Num> (<Num>{formatPercent(((finalPoints - points) / points) * 100, 0, true)}</Num>)
            </span>
          )}
        </Fig>
        <Fig label="سربه‌سر هر ۱ میلیون پوینت" help={<InlineHelp term="سربه‌سر">کمترین ارزشی که هر ۱ میلیون پوینت باید داشته باشد تا زیان نقدی YT جبران شود.</InlineHelp>}>
          {Number.isFinite(breakEven) ? breakEven === 0 ? <span className="text-sx-green">رایگان</span> : <Usd x={breakEven} digits={2} /> : <span className="text-sx-faint">—</span>}
        </Fig>
        <div className="col-span-2 lg:col-span-1 flex flex-col gap-1">
          <NumberField label="ارزش فرضی هر ۱ میلیون پوینت" value={perM} onChange={(n) => onPerM(Number.isFinite(n) ? Math.max(0, n) : 0)} suffix="دلار" />
          {last && Math.abs(last.valuePerMillion - perM) > 1e-9 && (
            <button type="button" className="tap self-start text-xs text-sx-accent underline underline-offset-4" onClick={() => onPerM(last.valuePerMillion)}>
              ارزش واقعی {last.season !== null ? <>فصل <Num>{formatNumber(last.season, 0)}</Num></> : 'قبلی'}: <Usd x={last.valuePerMillion} digits={2} /> — استفاده
            </button>
          )}
        </div>
      </dl>
      {perM > 0 && pts > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <Chip tone="warning">سناریو</Chip>
          {(
            [
              ['بد', 0.5],
              ['پایه', 1],
              ['خوب', 2],
            ] as const
          ).map(([label, k]) => (
            <span key={label} className="whitespace-nowrap">
              <span className="text-sx-muted">{label} </span>
              <Usd x={(pts / M) * perM * k} digits={0} />
            </span>
          ))}
          {below && <span className="text-sx-red text-xs">کمتر از سربه‌سر</span>}
        </div>
      )}
    </div>
  );
}

/** After distribution: tokens, sales, remaining, actual value per 1M points, and the total result. */
function Result({ link, cashUsd, onManualPrice }: { link: NonNullable<PositionView['airdrops'][number]>; cashUsd: number; onManualPrice: (usd: number) => void }) {
  const { program, summary: s, price, share } = link;
  const sym = program.token?.symbol ?? 'توکن';
  const mine = s.totalUsd === null ? null : s.totalUsd * share;
  const total = mine === null || !Number.isFinite(cashUsd) ? null : cashUsd + mine;
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Fig label="پوینت نهایی">{s.finalPoints !== null ? <Num>{formatCompact(s.finalPoints)}</Num> : <span className="text-sx-faint">—</span>}</Fig>
        <Fig label="توکن دریافتی">
          <Num>{formatToken(s.received, sym, 2)}</Num>
          {s.locked > 0 && (
            <span className="block text-xs text-sx-orange">
              قفل: <Num>{formatNumber(s.locked, 2)}</Num> تا {s.nextUnlock ? formatDate(s.nextUnlock) : '—'}
            </span>
          )}
        </Fig>
        <Fig label="فروخته‌شده">
          <Num>{formatNumber(s.sold, 2)}</Num>
          <span className="block text-xs text-sx-muted">{s.realizedUsd !== null ? <>خالص <Usd x={s.realizedUsd} /></> : 'نرخ دلاری فروش نامعلوم'}</span>
        </Fig>
        <Fig label="باقی‌مانده">
          <Num>{formatNumber(s.remaining, 2)}</Num>
          {s.remaining > 0 && (
            <span className="block text-xs text-sx-muted">
              {s.unrealizedUsd !== null ? (
                <>
                  ≈ <Usd x={s.unrealizedUsd} /> · {price?.source === 'manual' ? 'قیمت دستی' : 'قیمت بازار'}
                </>
              ) : (
                'قیمت نامعلوم'
              )}
            </span>
          )}
        </Fig>
      </dl>
      {s.remaining > 0 && price?.source !== 'market' && (
        <div className="max-w-xs">
          <NumberField label={`قیمت فعلی هر ${sym}`} value={program.manualPrice?.usd ?? NaN} onChange={(n) => Number.isFinite(n) && n > 0 && onManualPrice(n)} suffix="دلار" note={program.token?.address ? 'قیمت خودکار برای این آدرس پیدا نشد' : 'با ثبت آدرس قرارداد، قیمت خودکار خوانده می‌شود'} />
        </div>
      )}
      <dl className="grid grid-cols-1 sm:grid-cols-4 gap-4 border-t border-sx-border pt-4">
        <Fig label="ارزش واقعی هر ۱ میلیون پوینت">{s.valuePerMillion !== null ? <Usd x={s.valuePerMillion} digits={2} /> : <span className="text-sx-faint">—</span>}</Fig>
        <Fig label="نتیجه‌ی نقدی YT">
          <Pnl usd={cashUsd} size="sm" word={false} />
        </Fig>
        <Fig label={share < 0.999 ? `ایردراپ (سهم ${formatPercent(share * 100, 0)})` : 'ایردراپ'}>{mine !== null ? <Pnl usd={mine} size="sm" word={false} /> : <span className="text-sx-faint">—</span>}</Fig>
        <Fig label="نتیجه‌ی کل">{total !== null ? <Pnl usd={total} size="md" /> : <span className="text-sx-faint">—</span>}</Fig>
      </dl>
    </div>
  );
}

// ─── Forms: few fields, errors only after a save attempt ─────────────────────

function FormShell({ title, children, onCancel, onSubmit, error }: { title: string; children: ReactNode; onCancel: () => void; onSubmit: () => void; error: string | null }) {
  const [tried, setTried] = useState(false);
  return (
    <form
      className="rounded-lg border border-sx-border bg-sx-raised/40 p-4 flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (error) setTried(true);
        else onSubmit();
      }}
    >
      <h3 className="text-[15px] font-semibold">{title}</h3>
      {children}
      {tried && error && (
        <p role="alert" className="text-sm text-sx-red">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button type="submit" className={btn.primary}>
          ثبت
        </button>
        <button type="button" className={btn.ghost} onClick={onCancel}>
          انصراف
        </button>
      </div>
    </form>
  );
}

function DateTime({ label, value, onChange }: { label: string; value: string; onChange: (iso: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm min-w-0">
      {label}
      <input type="datetime-local" dir="ltr" value={toLocalInput(value)} max={toLocalInput(new Date().toISOString())} onChange={(e) => onChange(fromLocalInput(e.target.value))} className="w-full px-3 text-base" />
      {value && <span className="text-xs text-sx-faint">{formatDateTime(value)}</span>}
    </label>
  );
}

function StartForm({ p, programs, onSave, onCancel }: { p: Position; programs: AirdropProgram[]; onSave: (a: AirdropProgram) => void; onCancel: () => void }) {
  // Existing programs not yet linked — the same name first.
  const same = programs.filter((a) => !a.positionIds.includes(p.id)).sort((a, b) => Number(programKey(b.name) === programKey(p.points.name ?? '')) - Number(programKey(a.name) === programKey(p.points.name ?? '')));
  const [linkId, setLinkId] = useState('');
  const [name, setName] = useState(p.points.name ?? '');
  const [season, setSeason] = useState<number>(p.points.season ?? NaN);
  const error = linkId ? null : name.trim() ? null : 'نام برنامه‌ی پوینت را بنویسید (مثلاً Hylo XP).';
  return (
    <FormShell
      title="برنامه‌ی پوینت این پوزیشن"
      error={error}
      onCancel={onCancel}
      onSubmit={() => {
        const existing = programs.find((a) => a.id === linkId);
        onSave(existing ? { ...existing, positionIds: [...existing.positionIds, p.id] } : emptyProgram(newId(), name, Number.isFinite(season) ? season : null, p.id));
      }}
    >
      {same.length > 0 && (
        <SelectField
          label="پوینت‌ها با پوزیشن دیگری مشترک است؟"
          value={linkId}
          onChange={setLinkId}
          options={[{ value: '', label: 'نه — برنامه‌ی جدید' }, ...same.map((a) => ({ value: a.id, label: `${a.name}${a.season !== null ? ` · فصل ${formatNumber(a.season, 0)}` : ''}` }))]}
        />
      )}
      {!linkId && (
        <div className="grid grid-cols-2 gap-3">
          <TextField label="نام برنامه‌ی پوینت" value={name} onChange={setName} ltr placeholder="Hylo XP" />
          <NumberField label="فصل (اختیاری)" value={season} onChange={setSeason} />
        </div>
      )}
    </FormShell>
  );
}

function PointsForm({ program, estimate, onSave, onCancel }: { program: AirdropProgram; estimate: number; onSave: (a: AirdropProgram) => void; onCancel: () => void }) {
  const [amount, setAmount] = useState(program.finalPoints?.amount ?? NaN);
  const [at, setAt] = useState(program.finalPoints?.at ?? nowLocal());
  return (
    <FormShell title="پوینت نهایی از سایت پروژه" error={amount > 0 ? null : 'تعداد پوینت را از داشبورد پروژه وارد کنید.'} onCancel={onCancel} onSubmit={() => onSave({ ...program, finalPoints: { amount, at } })}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <NumberField label="پوینت نهایی" value={amount} onChange={setAmount} note={estimate > 0 ? <>تخمین اپ: <Num>{formatCompact(estimate)}</Num></> : undefined} />
        <DateTime label="تاریخ" value={at} onChange={setAt} />
      </div>
    </FormShell>
  );
}

function ClaimForm({ program, chain, onSave, onCancel }: { program: AirdropProgram; chain: string; onSave: (a: AirdropProgram) => void; onCancel: () => void }) {
  const [at, setAt] = useState(nowLocal());
  const [amount, setAmount] = useState(NaN);
  const [symbol, setSymbol] = useState(program.token?.symbol ?? '');
  const [net, setNet] = useState(program.token?.chain || chain);
  const [address, setAddress] = useState(program.token?.address ?? '');
  const [rate, setRate] = useState(NaN);
  const [fee, setFee] = useState(0);
  const [locked, setLocked] = useState(false);
  const [lockedAmount, setLockedAmount] = useState(NaN);
  const [unlockAt, setUnlockAt] = useState('');
  const auto = useCoinPrice(net, address, new Date(at).getTime());
  const error = !(amount > 0) ? 'تعداد توکن دریافتی را وارد کنید.' : !symbol.trim() ? 'نماد توکن را بنویسید.' : locked && !(lockedAmount > 0 && lockedAmount <= amount) ? 'مقدار قفل‌شده باید بین صفر و کل توکن باشد.' : null;
  return (
    <FormShell
      title="توکن دریافتی (claim)"
      error={error}
      onCancel={onCancel}
      onSubmit={() =>
        onSave({
          ...program,
          token: { symbol: symbol.trim(), chain: net, address: address.trim() || null },
          claims: [...program.claims, { id: newId(), at, amount, usdRate: Number.isFinite(rate) && rate > 0 ? rate : null, feeUsd: Number.isFinite(fee) ? fee : 0, lockedAmount: locked ? lockedAmount : 0, unlockAt: locked && unlockAt ? unlockAt : null }],
        })
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DateTime label="تاریخ دریافت" value={at} onChange={setAt} />
        <NumberField label="تعداد توکن" value={amount} onChange={setAmount} />
        <TextField label="نماد توکن" value={symbol} onChange={setSymbol} ltr placeholder="XYZ" />
        <SelectField label="شبکه" value={net} onChange={setNet} options={NETWORKS.map((n) => ({ value: n.name, label: n.nameFa }))} />
        <div className="sm:col-span-2">
          <TextField label="آدرس قرارداد یا mint (اختیاری)" value={address} onChange={setAddress} ltr help="با آدرس، قیمت دلاری توکن خودکار خوانده می‌شود. حروف آدرس سولانا را دقیقاً کپی کنید." />
        </div>
        <div className="flex flex-col gap-1">
          <NumberField label="قیمت هر توکن در روز دریافت" value={rate} onChange={setRate} suffix="دلار" />
          {auto && Math.abs(auto.usd - rate) > 1e-12 && (
            <button type="button" className="tap self-start text-xs text-sx-accent underline underline-offset-4" onClick={() => setRate(auto.usd)}>
              قیمت بازار: <Usd x={auto.usd} digits={6} /> — استفاده
            </button>
          )}
        </div>
        <NumberField label="کارمزد claim" value={fee} onChange={setFee} suffix="دلار" />
      </div>
      <label className="flex items-center gap-2 text-sm min-h-11">
        <input type="checkbox" checked={locked} onChange={(e) => setLocked(e.target.checked)} /> بخشی از توکن‌ها قفل است (vesting)
      </label>
      {locked && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <NumberField label="مقدار قفل‌شده" value={lockedAmount} onChange={setLockedAmount} />
          <TextField label="تاریخ آزاد شدن" type="date" value={unlockAt.slice(0, 10)} onChange={(d) => setUnlockAt(d ? `${d}T00:00:00.000Z` : '')} />
        </div>
      )}
      {networkByName(net).llama === null && <p className="text-xs text-sx-faint">برای این شبکه قیمت خودکار در دسترس نیست؛ قیمت را دستی وارد کنید.</p>}
    </FormShell>
  );
}

function SaleForm({ program, remaining, onSave, onCancel }: { program: AirdropProgram; remaining: number; onSave: (a: AirdropProgram) => void; onCancel: () => void }) {
  const chain = program.token?.chain ?? '';
  const tokens = useMemo(() => tokensForChain(chain), [chain]);
  const [at, setAt] = useState(nowLocal());
  const [amount, setAmount] = useState(NaN);
  const [recAmount, setRecAmount] = useState(NaN);
  const [recToken, setRecToken] = useState(tokens.find((t) => t.symbol === 'USDC')?.symbol ?? tokens[0]?.symbol ?? '');
  const [rate, setRate] = useState(NaN);
  const [fee, setFee] = useState(0);
  const listed = useTokenPrice(recToken, at);
  const usdRate = Number.isFinite(rate) && rate > 0 ? rate : listed?.usd ?? null;
  const sym = program.token?.symbol ?? 'توکن';
  const error = !(amount > 0) ? `تعداد ${sym} فروخته‌شده را وارد کنید.` : amount > remaining + 1e-9 ? `بیشتر از باقی‌مانده (${formatNumber(remaining, 4)}) است.` : !(recAmount > 0) ? 'مبلغ دریافتی را وارد کنید.' : !recToken.trim() ? 'ارز دریافتی را انتخاب کنید.' : null;
  return (
    <FormShell
      title={`فروش ${sym}`}
      error={error}
      onCancel={onCancel}
      onSubmit={() =>
        onSave({
          ...program,
          sales: [...program.sales, { id: newId(), at, amount, received: { amount: recAmount, token: recToken.trim(), usdRate, rateSource: Number.isFinite(rate) && rate > 0 ? 'manual' : listed?.source ?? 'unknown' }, feeUsd: Number.isFinite(fee) ? fee : 0 }],
        })
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <DateTime label="تاریخ فروش" value={at} onChange={setAt} />
        <NumberField label={`تعداد ${sym} فروخته‌شده`} value={amount} onChange={setAmount} note={<>باقی‌مانده: <Num>{formatNumber(remaining, 4)}</Num></>} />
        <NumberField label="مبلغ دریافتی" value={recAmount} onChange={setRecAmount} />
        <TokenSelect label="ارز دریافتی" value={recToken} onChange={setRecToken} tokens={tokens} />
        <NumberField label={`نرخ دلاری ${recToken || 'ارز دریافتی'}`} value={Number.isFinite(rate) ? rate : listed?.usd ?? NaN} onChange={setRate} suffix="دلار" note={!Number.isFinite(rate) && listed ? 'خودکار' : undefined} />
        <NumberField label="کارمزد" value={fee} onChange={setFee} suffix="دلار" />
      </div>
    </FormShell>
  );
}

function SharesForm({ program, views, onSave, onCancel }: { program: AirdropProgram; views: PositionView[]; onSave: (a: AirdropProgram) => void; onCancel: () => void }) {
  const linked = views.filter((x) => program.positionIds.includes(x.p.id));
  const [vals, setVals] = useState<Record<string, number>>(() => Object.fromEntries(linked.map((x) => [x.p.id, Math.round((x.airdrops.find((a) => a.program.id === program.id)?.share ?? 0) * 100)])));
  const total = Object.values(vals).reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0);
  return (
    <FormShell
      title="سهم هر پوزیشن از این برنامه"
      error={total > 0 ? null : 'دست‌کم یک سهم باید بیشتر از صفر باشد.'}
      onCancel={onCancel}
      onSubmit={() => onSave({ ...program, shares: Object.fromEntries(Object.entries(vals).map(([k, n]) => [k, Number.isFinite(n) ? Math.max(0, n) : 0])) })}
    >
      {linked.map((x) => (
        <NumberField key={x.p.id} label={`${x.p.kind.toUpperCase()} ${x.p.marketName} · سررسید ${formatDate(x.p.maturity)}`} value={vals[x.p.id]} onChange={(n) => setVals({ ...vals, [x.p.id]: n })} suffix="%" />
      ))}
      <div className="flex items-center justify-between text-xs text-sx-muted">
        <span>
          جمع <Num>{formatNumber(total, 0)}</Num> (به ۱۰۰ نرمال می‌شود)
        </span>
        <button type="button" className="tap text-sx-accent underline underline-offset-4" onClick={() => onSave({ ...program, shares: null })}>
          برگشت به تقسیم خودکار
        </button>
      </div>
    </FormShell>
  );
}

/** Recorded claims and sales, newest first, each removable. */
function History({ program, onSave, onUnlink }: { program: AirdropProgram; onSave: (a: AirdropProgram) => void; onUnlink: () => void }) {
  const sym = program.token?.symbol ?? 'توکن';
  const rows = [
    ...(program.finalPoints ? [{ id: 'points', at: program.finalPoints.at, text: <>پوینت نهایی <Num>{formatCompact(program.finalPoints.amount)}</Num></>, del: () => onSave({ ...program, finalPoints: null }) }] : []),
    ...program.claims.map((c) => ({ id: c.id, at: c.at, text: <>دریافت <Num>{formatToken(c.amount, sym, 2)}</Num>{c.usdRate !== null && <> · <Usd x={c.amount * c.usdRate} /></>}</>, del: () => onSave({ ...program, claims: program.claims.filter((y) => y.id !== c.id) }) })),
    ...program.sales.map((s) => ({ id: s.id, at: s.at, text: <>فروش <Num>{formatToken(s.amount, sym, 2)}</Num> → <Num>{formatToken(s.received.amount, s.received.token, 2)}</Num></>, del: () => onSave({ ...program, sales: program.sales.filter((y) => y.id !== s.id) }) })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <details className="group">
      <summary className="tap flex items-center gap-2 text-sm text-sx-muted min-h-10">
        <Link2 size={14} aria-hidden /> سوابق ایردراپ{rows.length > 0 && <> (<Num>{formatNumber(rows.length, 0)}</Num>)</>}
      </summary>
      <ul className="flex flex-col divide-y divide-sx-border mt-2 text-sm">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0">
              {r.text} <span className="text-xs text-sx-faint">· {formatDateTime(r.at)}</span>
            </span>
            <button type="button" aria-label="حذف" className="tap grid place-items-center size-10 rounded-md text-sx-faint hover:text-sx-red" onClick={() => window.confirm('این مورد حذف شود؟') && r.del()}>
              <Trash2 size={15} aria-hidden />
            </button>
          </li>
        ))}
        <li className="py-2">
          <button type="button" className="tap text-xs text-sx-faint hover:text-sx-red underline underline-offset-4" onClick={() => window.confirm('این پوزیشن از برنامه‌ی پوینت جدا شود؟') && onUnlink()}>
            جدا کردن این پوزیشن از برنامه
          </button>
        </li>
      </ul>
    </details>
  );
}
