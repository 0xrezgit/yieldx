'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ChevronDown, ExternalLink, Info, Layers, TriangleAlert } from 'lucide-react';
import protocols from '../../config/protocols.json';
import type { MarketData } from '../../types/market';
import type { GasQuote } from '../../lib/merkl/types';
import type { ProtocolId } from '../../types/protocol';
import { fetchMarket } from '../../lib/data/market-data';
import { breakEvenDays, calcFor, compareStrategies, exitMap, mintPreview, redeemPreview, tokenRate, type CalcInput, type CalcMarket, type CalcResult, type Strategy } from '../../lib/calculators/pendle-calc';
import { BASE_RATE_KIND, YT_YIELD_FEE_PCT } from '../../lib/calculators/trade';
import { baseScenarios } from '../../lib/opportunity/base-scenarios';
import { ytBaseOf } from '../../lib/risk/leaderboard';
import { txCost } from '../../lib/opportunity/costs';
import { listingLink } from '../../lib/market/links';
import { networkByName } from '../../lib/registry/networks';
import { formatDate, formatNumber, formatPercent, formatUSD } from '../../lib/utils/formatting';
import type { OpportunityListing } from '../../lib/risk/opportunities';
import { NumberField } from '../ui/field';
import { Num } from '../ui/num';
import { AssetIdentity } from '../ui/asset-identity';
import { MarketPicker } from '../forms/MarketPicker';
import { Segmented, signedPct } from './parts';
import { LoopResult, type CalcMode, type CalcState } from './Calculator';
import { PtLoopPosition } from './PtLoopPosition';

type Unit = 'usd' | 'token';
type Reading = 'likely' | 'now' | 'low';

const TABS: { id: CalcMode; label: ReactNode }[] = [
  { id: 'pt', label: 'PT' },
  { id: 'yt', label: 'YT' },
  { id: 'lp', label: 'LP' },
  { id: 'mint', label: 'Mint / Redeem' },
  { id: 'loop', label: <>لوپ PT</> },
];
const TITLE: Record<string, [string, string]> = {
  pt: ['پوزیشن PT', 'بازده ثابت تا سررسید.'],
  yt: ['پوزیشن YT', 'خرید بازده آینده تا سررسید.'],
  lp: ['پوزیشن LP', 'PT و دارایی پایه در استخر، با کارمزد سواپ.'],
};
const RISK: Record<Strategy, string> = {
  pt: 'بازپرداخت به دارایی حسابداری ثابت است، نه به دلار. فروش پیش از سررسید به نرخ آن روز بستگی دارد.',
  yt: 'اگر بازده واقعی کمتر شود ضرر می‌کنید؛ YT در سررسید صفر می‌شود. نرخ روز فروش با اهرم بالا اثر دارد.',
  lp: 'ترکیب استخر با معاملات عوض می‌شود (این‌جا ثابت فرض شده)؛ ریسک PT، دارایی پایه و قرارداد.',
  hold: 'فقط ریسک خود دارایی.',
};
const STRATEGY_NAME: Record<Strategy, string> = { hold: 'نگه داشتن دارایی', pt: 'PT', yt: 'YT', lp: 'LP' };

/** The market as the model needs it: from the list row, refined by the market's own data. */
function marketOf(row: OpportunityListing | null, data: MarketData | null, c: CalcState): CalcMarket {
  if (!row) {
    return { protocol: 'manual', daysToMaturity: c.days, impliedPct: c.entryAPY, basePct: c.baseAPY, yieldFeePct: 0, accountingUsd: 1, tokenSymbol: 'USD' };
  }
  const usdQuoted = data?.ytUnit === 'usd';
  const accountingUsd = usdQuoted ? 1 : (data?.underlyingPrice ?? row.unitUsd ?? 1);
  const tokenUsd = usdQuoted ? (data?.underlyingPrice ?? row.unitUsd ?? null) : (data?.tokenUsd ?? null);
  const { basePct } = ytBaseOf(row);
  return {
    protocol: row.protocol,
    daysToMaturity: row.daysToMaturity,
    impliedPct: row.impliedAPY,
    basePct: Number.isFinite(basePct) ? basePct : 0,
    baseLevels: row.baseLevels,
    ammFeeLn: data?.ammFeeLn ?? row.ammFeeLn ?? null,
    yieldFeePct: YT_YIELD_FEE_PCT[row.protocol] ?? 0,
    rateKind: BASE_RATE_KIND[row.protocol],
    accountingUsd,
    tokenUsd,
    tokenSymbol: row.asset?.symbol ?? row.name,
    lp: data?.lp ?? null,
  };
}

function money(x: number, unit: Unit, m: CalcMarket) {
  if (unit === 'usd') return formatUSD(x, Math.abs(x) >= 100 ? 0 : 2, true);
  const t = x / tokenRate(m);
  return `${t >= 0 ? '+' : '−'}${formatNumber(Math.abs(t), Math.abs(t) >= 100 ? 1 : 3)} ${m.tokenSymbol}`;
}
/** Accounting units → USD or token, signed. */
const conv = (accUnits: number, unit: Unit, m: CalcMarket) => money(unit === 'usd' ? accUnits * m.accountingUsd : accUnits, unit, m);
const tone = (x: number) => (x >= 0 ? 'text-success' : 'text-danger');

function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`sx-card p-4 sm:p-6 flex flex-col gap-4 ${className}`}>{children}</section>;
}

function Tile({ label, children, tone: t = 'text-primary' }: { label: string; children: ReactNode; tone?: string }) {
  return (
    <div className="rounded-xl bg-elevated border border-default px-4 py-3 flex flex-col gap-1">
      <span className="text-xs text-muted">{label}</span>
      <span className={`text-2xl font-semibold ${t}`}>{children}</span>
    </div>
  );
}

function Row({ label, hint, children, valueTone }: { label: string; hint?: string; children: ReactNode; valueTone?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-default last:border-0">
      <span className="flex flex-col">
        <span className="text-sm text-primary">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
      </span>
      <span className={`text-sm font-medium whitespace-nowrap ${valueTone ?? 'text-primary'}`}>{children}</span>
    </div>
  );
}

/** Pendle-style date × exit-rate grid; a click applies that cell. */
function ExitMap({ m, input, strategy, unit, onPick, current }: { m: CalcMarket; input: CalcInput; strategy: Strategy; unit: Unit; onPick: (days: number, rate: number) => void; current: { days: number; rate: number } }) {
  const map = useMemo(() => exitMap(m, input, strategy), [m, input, strategy]);
  const today = Date.now();
  return (
    <details className="group rounded-xl border border-default bg-surface" open>
      <summary className="tap flex items-center justify-between gap-2 px-4 min-h-12 text-sm font-semibold text-primary">
        نقشه‌ی تاریخ × نرخ خروج
        <ChevronDown size={15} className="transition-transform group-open:rotate-180 text-muted" aria-hidden />
      </summary>
      <div className="overflow-x-auto px-2 pb-3 sm:px-3">
        <table className="w-full min-w-[30rem] text-xs sm:text-sm border-separate border-spacing-1">
          <thead>
            <tr className="text-muted">
              <th className="px-2 py-1 text-right font-medium">نرخ خروج</th>
              {map.days.map((d, k) => (
                <th key={d} className="px-2 py-1 text-left font-medium">
                  <span className="flex flex-col items-end leading-tight">
                    <span className="text-secondary">{formatDate(new Date(today + d * 86_400_000).toISOString())}</span>
                    <span className="text-xs">{k === map.days.length - 1 && d >= m.daysToMaturity ? 'سررسید' : <><Num>{formatNumber(d, 0)}</Num> روز</>}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {map.rates.map((r, i) => (
              <tr key={r}>
                <td className="px-2 py-1.5 text-secondary whitespace-nowrap">
                  <Num>{formatPercent(r, 2)}</Num> {Math.abs(r - m.impliedPct) < 1e-9 && <span className="text-xs text-muted">امروز</span>}
                </td>
                {map.days.map((d, k) => {
                  const v = map.cells[i][k];
                  const on = current.days === d && Math.abs(current.rate - r) < 1e-9;
                  return (
                    <td key={d} className="p-0">
                      <button
                        type="button"
                        onClick={() => onPick(d, r)}
                        className={`tap w-full rounded-md px-2 py-1.5 text-left font-medium whitespace-nowrap transition-colors ${v === null ? 'text-muted' : v >= 0 ? 'bg-success/10 text-success hover:bg-success/20' : 'bg-danger/10 text-danger hover:bg-danger/20'} ${on ? 'ring-1 ring-accent' : ''}`}
                      >
                        {v === null ? '—' : <Num>{conv(v, unit, m)}</Num>}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-xs text-muted px-2 pt-1">روی هر خانه بزنید تا همان تاریخ و نرخ خروج اعمال شود.</p>
      </div>
    </details>
  );
}

function Strategies({ m, input, unit }: { m: CalcMarket; input: CalcInput; unit: Unit }) {
  const c = useMemo(() => compareStrategies(m, input), [m, input]);
  const best = c.rows.reduce<{ s: Strategy; v: number } | null>((b, r) => {
    const v = r.byReading.likely?.net;
    return v !== undefined && v !== null && (!b || v > b.v) ? { s: r.strategy, v } : b;
  }, null);
  return (
    <section className="rounded-xl border border-default bg-surface p-3 sm:p-4 flex flex-col gap-2" aria-label="مقایسه‌ی استراتژی‌ها">
      <h3 className="text-sm font-semibold text-primary flex items-center gap-2">
        <Layers size={15} className="text-accent" aria-hidden /> همین سرمایه و همین تاریخ خروج، در هر استراتژی
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[26rem] text-xs sm:text-sm">
          <thead className="text-muted">
            <tr className="border-b border-default">
              <th className="py-2 px-2 text-right font-medium">استراتژی</th>
              <th className="py-2 px-2 text-right font-medium">بدبینانه <span className="text-xs">(<Num>{formatPercent(c.readings.low, 1)}</Num>)</span></th>
              <th className="py-2 px-2 text-right font-medium">محتمل <span className="text-xs">(<Num>{formatPercent(c.readings.likely, 1)}</Num>)</span></th>
              <th className="py-2 px-2 text-right font-medium">خوش‌بینانه <span className="text-xs">(<Num>{formatPercent(c.readings.high, 1)}</Num>)</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-default">
            {c.rows.map((r) => (
              <tr key={r.strategy} className={best?.s === r.strategy ? 'bg-brand/[0.06]' : ''}>
                <td className="py-2 px-2 font-medium text-primary whitespace-nowrap">
                  {STRATEGY_NAME[r.strategy]} {best?.s === r.strategy && <span className="text-xs text-accent">بهترین</span>}
                </td>
                {(['low', 'likely', 'high'] as const).map((k) => {
                  const v = r.byReading[k];
                  return (
                    <td key={k} className={`py-2 px-2 whitespace-nowrap ${v ? tone(v.net) : 'text-muted'}`}>
                      {v ? <Num>{conv(v.net, unit, m)}</Num> : '—'}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted leading-6">ستون‌ها بازده پایه‌ی دارایی‌اند (بدبینانه = کمترین نرخ اخیر، محتمل = نرخ امروز که به سطح ماه اخیر نزدیک می‌شود). PT نگه‌داشته تا سررسید به بازده پایه بستگی ندارد.</p>
    </section>
  );
}

function MintRedeem({ m, link, unit }: { m: CalcMarket; link: string | null; unit: Unit }) {
  const [mode, setMode] = useState<'mint' | 'redeem'>('mint');
  const [tokens, setTokens] = useState(1000);
  const [pt, setPt] = useState(1000);
  const [yt, setYt] = useState(1000);
  const mint = mintPreview(m, tokens);
  const red = redeemPreview(m, pt, yt);
  const u = (x: number) => formatNumber(x, x >= 100 ? 2 : 4);
  return (
    <Card>
      <Segmented<'mint' | 'redeem'> value={mode} onChange={setMode} label="Mint یا Redeem" options={[{ id: 'mint', label: 'Mint' }, { id: 'redeem', label: 'Redeem' }]} />
      <p className="text-sm text-secondary leading-7 rounded-lg bg-elevated px-3 py-2">
        <b className="text-primary">نکته:</b>{' '}
        {mode === 'mint'
          ? 'Mint دارایی را بدون کارمزد AMM به PT و YT برابر تبدیل می‌کند. Mint و فروش یکی، همان نتیجه‌ی خرید مستقیم دیگری را دارد (Mint و فروش YT = خرید PT؛ Mint و فروش PT = خرید YT)، فقط گس متفاوت است.'
          : 'پیش از سررسید برای Redeem باید PT و YT هم‌اندازه داشته باشید؛ بعد از سررسید فقط PT کافی است.'}
      </p>
      {mode === 'mint' ? (
        <>
          <NumberField label={`ورودی (${m.tokenSymbol})`} value={tokens} onChange={(v) => setTokens(Number.isFinite(v) ? Math.max(0, v) : 0)} note={<Num>{formatUSD(tokens * (m.tokenUsd ?? m.accountingUsd), 2)}</Num>} />
          <ArrowDown size={16} className="self-center text-muted" aria-hidden />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Tile label="PT دریافتی">
              <Num>{u(mint.pt)}</Num>
              <span className="block text-xs text-muted font-normal"><Num>{formatUSD(mint.ptUsd, 2)}</Num></span>
            </Tile>
            <Tile label="YT دریافتی">
              <Num>{u(mint.yt)}</Num>
              <span className="block text-xs text-muted font-normal"><Num>{formatUSD(mint.ytUsd, 2)}</Num></span>
            </Tile>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <NumberField label="PT" value={pt} onChange={(v) => setPt(Number.isFinite(v) ? Math.max(0, v) : 0)} />
            <NumberField label="YT" value={yt} onChange={(v) => setYt(Number.isFinite(v) ? Math.max(0, v) : 0)} />
          </div>
          <ArrowDown size={16} className="self-center text-muted" aria-hidden />
          <Tile label={`خروجی (${m.tokenSymbol})`}>
            <Num>{u(red.tokens)}</Num>
            <span className="block text-xs text-muted font-normal"><Num>{formatUSD(red.usd, 2)}</Num></span>
          </Tile>
          {(red.leftover.pt > 1e-9 || red.leftover.yt > 1e-9) && (
            <p className="text-xs text-warning">
              باقی می‌ماند: <Num>{u(red.leftover.pt)}</Num> PT و <Num>{u(red.leftover.yt)}</Num> YT (پیش از سررسید فقط جفت برابر Redeem می‌شود).
            </p>
          )}
        </>
      )}
      <p className="text-xs text-muted">Mint و Redeem کارمزد AMM ندارند؛ فقط گس شبکه. {unit === 'token' ? '' : 'ارزش‌ها به قیمت امروز.'}</p>
      {link && (
        <a href={link} target="_blank" rel="noopener noreferrer" className="tap inline-flex items-center justify-center gap-1.5 rounded-md bg-brand text-on-brand px-4 min-h-11 text-sm font-medium">
          <ExternalLink size={15} aria-hidden /> {mode === 'mint' ? 'Mint' : 'Redeem'} در اپ پروتکل
        </a>
      )}
    </Card>
  );
}

/**
 * «ماشین‌حساب» in the layout of Pendle's Yield Calculator: the market and its maturity,
 * PT / YT / LP / Mint‑Redeem / PT loop; the position on one side, the projected result on the
 * other in dollars or in the token, its details and fees, the date × exit-rate map and every
 * strategy side by side under three underlying readings.
 */
export function PendleCalculator({ c, set, markets, onPick, gas }: { c: CalcState; set: (p: Partial<CalcState>) => void; markets: OpportunityListing[]; onPick: (m: OpportunityListing) => void; gas: GasQuote[] }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const closePicker = useCallback(() => setPickerOpen(false), []);
  const [data, setData] = useState<MarketData | null>(null);
  const [unit, setUnit] = useState<Unit>('usd');
  const [reading, setReading] = useState<Reading>('likely');
  const [capital, setCapital] = useState(1000);
  const [hold, setHold] = useState<number | null>(null);
  const [exitRate, setExitRate] = useState<number | null>(null);
  const [baseTyped, setBaseTyped] = useState<number | null>(null);
  const [priceMove, setPriceMove] = useState(0);
  const [rewards, setRewards] = useState(true);

  const row = useMemo(() => (c.protocol ? (markets.find((m) => m.protocol === c.protocol && m.id === c.marketId) ?? null) : null), [markets, c.protocol, c.marketId]);
  useEffect(() => {
    setData(null);
    setHold(null);
    setExitRate(null);
    setBaseTyped(null);
    if (!c.protocol || !c.marketId) return;
    const ctl = new AbortController();
    fetchMarket(c.protocol as ProtocolId, c.marketId, 0, ctl.signal)
      .then((r) => setData(r.market))
      .catch(() => {});
    return () => ctl.abort();
  }, [c.protocol, c.marketId]);

  const m = useMemo(() => marketOf(row, data, c), [row, data, c]);
  const D = Math.max(1, Math.round(m.daysToMaturity));
  const sc = useMemo(() => baseScenarios(m.basePct, m.baseLevels, D), [m.basePct, m.baseLevels, D]);
  const base = baseTyped ?? (reading === 'now' ? m.basePct : reading === 'low' ? sc.low : sc.likely);
  const days = Math.min(D, Math.max(1, hold ?? D));
  const rate = exitRate ?? m.impliedPct;
  const tx = row ? txCost(networkByName(row.chain).key, ['swap'], gas).usd : 0;
  const input: CalcInput = useMemo(() => ({ capitalTokens: capital, holdDays: days, exitImpliedPct: rate, basePct: base, assumedFeePct: c.fee, txUsd: tx, priceMovePct: priceMove, withRewards: rewards }), [capital, days, rate, base, c.fee, tx, priceMove, rewards]);
  const tab = c.mode;
  const strategy: Strategy | null = tab === 'pt' || tab === 'yt' || tab === 'lp' ? tab : null;
  const result: CalcResult | null = strategy ? calcFor(strategy)(m, input) : null;
  const beDays = useMemo(() => (strategy && strategy !== 'yt' ? breakEvenDays(m, input, strategy) : null), [m, input, strategy]);
  const link = row ? listingLink(row.protocol, row, tab === 'yt' ? 'yt' : 'pt') : null;
  const tokenUsd = m.tokenUsd ?? m.accountingUsd;

  return (
    <div className="flex flex-col gap-4">
      {/* Market · maturity · tabs */}
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.2fr)] gap-3">
        <button type="button" onClick={() => setPickerOpen(true)} aria-haspopup="dialog" className="w-full flex items-center gap-3 rounded-xl border border-default bg-surface px-3 min-h-14 text-right hover:border-strong">
          {row ? <AssetIdentity symbol={row.name} icon={row.icon} chain={row.chain} protocol={row.protocol} size={32} className="flex-1" /> : <span className="flex-1 text-secondary">انتخاب بازار</span>}
          <ChevronDown size={18} className="text-muted shrink-0" aria-hidden />
        </button>
        <div className="flex items-center gap-2 rounded-xl border border-default bg-surface px-4 min-h-14 text-sm">
          {row ? (
            <>
              <span className="font-semibold text-primary">{formatDate(row.maturity)}</span>
              <span className="text-muted"><Num>{formatNumber(D, 0)}</Num> روز</span>
            </>
          ) : (
            <span className="text-muted">سررسید</span>
          )}
        </div>
        <Segmented<CalcMode> value={tab} onChange={(mode) => set({ mode })} label="نوع" options={TABS} />
      </div>
      <MarketPicker open={pickerOpen} onClose={closePicker} markets={markets} loading={!markets.length} selectedId={c.marketId} onSelect={(x) => onPick(x as OpportunityListing)} title="انتخاب بازار" updatedAt={null} showProtocol />

      {!row && tab !== 'loop' ? (
        <Card className="items-center text-center py-12">
          <p className="text-secondary">یک بازار انتخاب کنید تا بازده PT، YT و LP آن را با کارمزد واقعی ببینید.</p>
          <button type="button" onClick={() => setPickerOpen(true)} className="tap rounded-md bg-brand text-on-brand px-4 min-h-11 text-sm font-medium">انتخاب بازار</button>
        </Card>
      ) : tab === 'loop' ? (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-4 items-start">
          <Card>
            <h2 className="text-lg font-semibold text-primary">لوپ PT</h2>
            <PtLoopPosition c={c} set={set} row={row} />
          </Card>
          <div className="flex flex-col gap-4">
            <LoopResult c={{ ...c, mode: 'loop', fee: c.loopFee }} />
          </div>
        </div>
      ) : tab === 'mint' ? (
        <MintRedeem m={m} link={link?.url ?? null} unit={unit} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] gap-4 items-start">
          {/* Position */}
          <Card>
            <div className="flex flex-col">
              <h2 className="text-lg font-semibold text-primary">{TITLE[tab][0]}</h2>
              <p className="text-sm text-muted">{TITLE[tab][1]}</p>
            </div>
            <NumberField label={`سرمایه (${m.tokenSymbol})`} value={capital} onChange={(v) => setCapital(Number.isFinite(v) ? Math.max(0, v) : 0)} note={<Num>{formatUSD(capital * tokenUsd, 2)}</Num>} />

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-sm text-secondary">تاریخ خروج</span>
                <span className="text-sm text-primary font-medium">
                  {formatDate(new Date(Date.now() + days * 86_400_000).toISOString())} · <Num>{formatNumber(days, 0)}</Num> روز {days >= D && <span className="text-success text-xs">نگه‌داری تا سررسید</span>}
                </span>
              </div>
              <input type="range" min={1} max={D} value={days} onChange={(e) => setHold(Number(e.target.value))} aria-label="روز نگه‌داری" className="w-full" />
              <div className="flex justify-between text-xs text-muted">
                <span>امروز</span>
                <span>سررسید</span>
              </div>
            </div>

            <div className="flex flex-col gap-2 border-t border-default pt-4">
              <span className="text-xs font-semibold text-muted">نرخ‌های به‌کاررفته</span>
              <NumberField label="بازده پایه (Underlying APY)" value={Math.round(base * 100) / 100} onChange={(v) => setBaseTyped(Number.isFinite(v) ? v : null)} suffix="%" />
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    ['likely', 'محتمل', sc.likely],
                    ['now', 'امروز', m.basePct],
                    ['low', 'بدبینانه', sc.low],
                  ] as const
                ).map(([id, label, v]) => (
                  <button key={id} type="button" onClick={() => (setReading(id), setBaseTyped(null))} aria-pressed={baseTyped === null && reading === id} className={`tap rounded-full border px-3 min-h-8 text-xs ${baseTyped === null && reading === id ? 'border-accent bg-accent/10 text-primary' : 'border-default text-secondary hover:text-primary'}`}>
                    {label} <Num>{formatPercent(v, 2)}</Num>
                  </button>
                ))}
              </div>
              {days < D && <NumberField label="نرخ ضمنی روز خروج" value={Math.round(rate * 100) / 100} onChange={(v) => setExitRate(Number.isFinite(v) ? v : null)} suffix="%" help="قیمت فروش PT/YT در آن روز با این نرخ تعیین می‌شود؛ پیش‌فرض نرخ امروز." />}
              <NumberField label="تغییر قیمت دلاری دارایی تا خروج" value={priceMove} onChange={(v) => setPriceMove(Number.isFinite(v) ? v : 0)} suffix="%" help="فقط نتیجه‌ی دلاری را عوض می‌کند؛ نتیجه به واحد دارایی همان است." />
              {tab === 'lp' && (
                <label className="flex items-center gap-2 text-sm text-secondary min-h-10">
                  <input type="checkbox" checked={rewards} onChange={(e) => setRewards(e.target.checked)} /> پاداش استخر (PENDLE) هم حساب شود
                </label>
              )}
              {m.protocol !== 'pendle' && m.protocol !== 'exponent' && <NumberField label="کارمزد فرضی" value={c.fee} onChange={(v) => set({ fee: v })} suffix="%" help="کارمزد این پروتکل معلوم نیست." />}
            </div>

            {result && (
              <details className="group rounded-xl bg-elevated border border-default">
                <summary className="tap flex items-center justify-between gap-2 px-4 min-h-12 text-sm font-semibold text-primary">
                  کارمزد و لغزش
                  <span className="flex items-center gap-2 text-secondary font-normal">
                    <Num>{formatUSD(result.fees.total * m.accountingUsd, 2)}</Num>
                    <ChevronDown size={15} className="transition-transform group-open:rotate-180" aria-hidden />
                  </span>
                </summary>
                <div className="px-4 pb-3">
                  <Row label="کارمزد ورود" hint={m.protocol === 'pendle' ? 'کارمزد AMM پندل' : m.protocol === 'exponent' ? 'دفتر سفارش Exponent' : 'فرضی'}><Num>{formatUSD(result.fees.entry * m.accountingUsd, 2)}</Num></Row>
                  {result.fees.exit > 0 && <Row label="کارمزد خروج" hint="فروش پیش از سررسید"><Num>{formatUSD(result.fees.exit * m.accountingUsd, 2)}</Num></Row>}
                  {result.fees.protocol > 0 && <Row label="سهم پروتکل از بازده YT" hint={`${formatPercent(m.yieldFeePct, 1)}`}><Num>{formatUSD(result.fees.protocol * m.accountingUsd, 2)}</Num></Row>}
                  <Row label="گس شبکه" hint="ورود (تأیید + معامله) و خروج"><Num>{formatUSD(result.fees.gas * m.accountingUsd, 2)}</Num></Row>
                </div>
              </details>
            )}
          </Card>

          {/* Result */}
          {result && (
            <div className="flex flex-col gap-4 min-w-0">
              <Card>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-lg font-semibold text-primary">نتیجه‌ی پیش‌بینی</h2>
                  <Segmented<Unit> value={unit} onChange={setUnit} label="واحد" size="sm" options={[{ id: 'usd', label: 'دلار' }, { id: 'token', label: <bdi dir="ltr">{m.tokenSymbol}</bdi> }]} />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-sm text-secondary">سود خالص تخمینی · <Num>{formatNumber(days, 0)}</Num> روز</span>
                  <span className={`hero-num font-semibold ${tone(unit === 'usd' ? result.netUsd : result.net)}`}>
                    <Num>{unit === 'usd' ? formatUSD(result.netUsd, 2, true) : conv(result.net, 'token', m)}</Num>
                  </span>
                  <span className="text-xs text-muted">{unit === 'usd' ? <>معادل <Num>{conv(result.net, 'token', m)}</Num></> : <>معادل <Num>{formatUSD(result.netUsd, 2, true)}</Num></>}</span>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Tile label="بازده دوره" tone={tone(result.hprPct)}>
                    <Num>{signedPct(result.hprPct, 2)}</Num>
                  </Tile>
                  <Tile label="بازده سالانه" tone={result.annualPct === null ? 'text-muted' : tone(result.annualPct)}>
                    {result.annualPct === null ? <span className="text-base">کوتاه‌تر از ۷ روز</span> : <Num>{formatPercent(result.annualPct, 2)}</Num>}
                  </Tile>
                </div>
                <div className="flex gap-2 rounded-xl border border-warning/30 bg-warning/8 px-4 py-3 text-sm">
                  <TriangleAlert size={16} className="text-warning shrink-0 mt-0.5" aria-hidden />
                  <span className="text-secondary leading-6"><b className="text-warning">ریسک پوزیشن: </b>{RISK[result.strategy]}</span>
                </div>
                <div className="rounded-xl border border-default">
                  <div className="px-4 py-2 text-sm font-semibold text-primary border-b border-default">جزئیات</div>
                  <div className="px-4">
                    <Row label="بازده ناخالص" hint="پیش از کارمزد و اثر قیمت" valueTone={tone(result.gross)}><Num>{conv(result.gross, unit, m)}</Num></Row>
                    {result.lines.map((l) => (
                      <Row key={l.label} label={l.label} valueTone={tone(l.value)}><Num>{conv(l.value, unit, m)}</Num></Row>
                    ))}
                    <Row label="کل کارمزدها" hint="ورود، خروج، سهم پروتکل و گس" valueTone="text-danger"><Num>{conv(-result.fees.total, unit, m)}</Num></Row>
                    {result.exposureUsd !== null && <Row label="اکسپوژر بازده" hint="حق بازده‌ای که YT می‌خرد"><Num>{formatUSD(result.exposureUsd, 0)}</Num></Row>}
                    {result.strategy !== 'yt' ? (
                      <Row label="روز جبران کارمزد" hint="با نرخ بازار ثابت">{beDays === null ? '—' : <><Num>{formatNumber(beDays, 0)}</Num> روز</>}</Row>
                    ) : (
                      <Row label="بازده پایه‌ی سربه‌سر" hint="بازده پایه‌ای که سود خالص را صفر می‌کند">{result.breakEvenBasePct === null ? '—' : <Num>{formatPercent(result.breakEvenBasePct, 2)}</Num>}</Row>
                    )}
                  </div>
                </div>
                {link && (
                  <a href={link.url} target="_blank" rel="noopener noreferrer" className="tap inline-flex items-center justify-center gap-1.5 rounded-md bg-brand text-on-brand px-4 min-h-11 text-sm font-medium">
                    <ExternalLink size={15} aria-hidden /> {link.exact ? `خرید ${tab.toUpperCase()} در ${protocols[row!.protocol].name}` : `اپ ${protocols[row!.protocol].name}`}
                  </a>
                )}
              </Card>
              {strategy && <ExitMap m={m} input={input} strategy={strategy} unit={unit} current={{ days, rate }} onPick={(d, r) => (setHold(d), setExitRate(r))} />}
              <Strategies m={m} input={input} unit={unit} />
              <p className="flex gap-1.5 text-xs text-muted leading-6">
                <Info size={13} className="shrink-0 mt-1" aria-hidden />
                فرض‌ها: نرخ‌ها و قیمت‌ها از داده‌ی امروز بازار؛ کارمزد AMM پندل از نرخ کارمزد خود بازار؛ ترکیب استخر LP ثابت؛ قیمت دارایی ثابت مگر آن را تغییر دهید. تخمینی است، نه توصیه‌ی مالی.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
