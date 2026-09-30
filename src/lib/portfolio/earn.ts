import type { EarnEvent, EarnFamily, EarnPosition, Mark } from '../../types/earn';
import type { Estimate, Opportunity, OpportunityFamily } from '../../types/opportunity';
import type { Quality } from './valuation';
import { separateFeesUsd, sortEvents as sortTimed, usdOf } from './ledger';
import { tokenClass } from '../merkl/vetting';
import { DAY_MS } from '../utils/math';

/**
 * Valuation of lending / vault / fixed-rate / loop / LP / borrow positions —
 * report §7-2. Same convention as the PT/YT ledger:
 *
 *   C (contributions) = deposits + repayments + fees paid on top
 *   W (withdrawals)   = withdrawals + claimed rewards + borrowed cash
 *   P&L = (value now − debt now) + W − C
 *
 * Value now: the balance the user read from the protocol (a dated mark), plus
 * later deposits/withdrawals; without a mark, principal accrued at today's rate —
 * labelled an estimate. Nothing unknown is set to zero; an event without a USD
 * rate makes the total «incomplete».
 */

const EPS = 1e-9;
const growth = (apy: number, days: number) => Math.pow(1 + apy / 100, Math.max(0, days) / 365) - 1;

export interface EarnInputs {
  /** Live supply rate for the linked opportunity, %/year APY; null → the manual one. */
  rate: number | null;
  borrowRate: number | null;
  /** Live USD prices, when known. */
  assetUsd: number | null;
  debtUsd: number | null;
}

export interface EarnValuation {
  balanceUnits: number;
  balanceQuality: Quality;
  debtUnits: number;
  debtQuality: Quality;
  assetUsd: { value: number; quality: Quality };
  debtAssetUsd: { value: number; quality: Quality };
  valueUsd: number;
  debtUsd: number;
  /** Value − debt: in a loop only this counts in the portfolio, never the gross collateral. */
  netValueUsd: number;
  contributionsUsd: number;
  withdrawalsUsd: number;
  pnlUsd: number;
  realizedUsd: number;
  unrealizedUsd: number;
  rewardsUsd: number;
  feesUsd: number;
  exitCostUsd: number | null;
  /** What exiting now would leave, after the exit cost; null when that cost is unknown. */
  exitNowUsd: number | null;
  rateUsed: number | null;
  borrowRateUsed: number | null;
  /** Events whose USD rate is missing. */
  missingRates: number;
  /** «برآورد ناقص»: a missing rate, or a value that is not a dated reading. */
  incomplete: boolean;
  reasons: string[];
  health: { ltv: number; maxLtv: number; health: number } | null;
  status: 'open' | 'closed';
}

const sortEvents = (e: EarnEvent[]) => sortTimed(e as never) as unknown as EarnEvent[];

/** Principal (in asset units) replayed from `from` onward, each flow accrued at `rate` until `now`. */
function accrue(events: EarnEvent[], types: { add: EarnEvent['type']; sub: EarnEvent['type'] }, rate: number, fromMs: number, nowMs: number): number {
  let units = 0;
  for (const e of events) {
    const t = new Date(e.at).getTime();
    if (!(t > fromMs)) continue;
    const g = 1 + growth(rate, (nowMs - t) / DAY_MS);
    if (e.type === types.add) units += e.cash.amount * g;
    else if (e.type === types.sub) units -= e.cash.amount * g;
  }
  return units;
}

function side(events: EarnEvent[], mark: Mark | null, rate: number | null, types: { add: EarnEvent['type']; sub: EarnEvent['type'] }, nowMs: number): { units: number; quality: Quality } {
  if (mark) {
    const t = new Date(mark.at).getTime();
    // After the reading: later flows at face value plus today's rate if known.
    const after = accrue(events, types, rate ?? 0, t, nowMs);
    const markGrowth = rate !== null ? growth(rate, (nowMs - t) / DAY_MS) : 0;
    return { units: Math.max(0, mark.amount * (1 + markGrowth) + after), quality: nowMs - t > 7 * DAY_MS ? 'stale' : 'manual' };
  }
  const units = Math.max(0, accrue(events, types, rate ?? 0, -Infinity, nowMs));
  return { units, quality: rate === null ? 'missing' : 'estimate' };
}

const lastRate = (events: EarnEvent[], symbol: string) => {
  for (const e of [...events].reverse()) if (e.cash.token === symbol && e.cash.usdRate !== null) return e.cash.usdRate;
  return null;
};

function price(live: number | null, manual: number | null, symbol: string, events: EarnEvent[]): { value: number; quality: Quality } {
  if (live !== null && live > 0) return { value: live, quality: 'market' };
  if (manual !== null && manual > 0) return { value: manual, quality: 'manual' };
  if (tokenClass({ symbol }) === 'usd') return { value: 1, quality: 'rule' };
  const r = lastRate(events, symbol);
  return r !== null ? { value: r, quality: 'stale' } : { value: NaN, quality: 'missing' };
}

export function valueEarn(p: EarnPosition, live: EarnInputs, now = Date.now()): EarnValuation {
  const events = sortEvents(p.events);
  const rate = live.rate ?? p.manualRate;
  const borrowRate = live.borrowRate ?? p.manualBorrowRate;
  const reasons: string[] = [];

  let C = 0;
  let W = 0;
  let rewards = 0;
  let fees = 0;
  let missing = 0;
  let costUsd = 0;
  let principal = 0;
  let realized = 0;
  for (const e of events) {
    const cash = usdOf(e.cash);
    const fee = separateFeesUsd(e.fees);
    if (!Number.isFinite(cash) || !Number.isFinite(fee)) missing++;
    const c = Number.isFinite(cash) ? cash : 0;
    const f = Number.isFinite(fee) ? fee : 0;
    fees += e.fees.reduce((a, x) => a + (Number.isFinite(usdOf(x)) ? usdOf(x) : 0), 0);
    switch (e.type) {
      case 'deposit':
        C += c + f;
        costUsd += c + f;
        principal += e.cash.amount;
        break;
      case 'withdraw': {
        const share = principal > EPS ? Math.min(1, e.cash.amount / principal) : 1;
        const removed = costUsd * share;
        costUsd -= removed;
        principal = Math.max(0, principal - e.cash.amount);
        W += c - f;
        realized += c - f - removed;
        break;
      }
      case 'claim_reward':
        W += c - f;
        rewards += c - f;
        realized += c - f;
        break;
      case 'borrow':
        W += c;
        C += f;
        realized -= f;
        break;
      case 'repay':
        C += c + f;
        realized -= f;
        break;
    }
  }

  const nowMs = now;
  const bal = side(events, p.balance, rate, { add: 'deposit', sub: 'withdraw' }, nowMs);
  const hasDebt = events.some((e) => e.type === 'borrow') || p.debt !== null;
  const debt = hasDebt ? side(events, p.debt, borrowRate, { add: 'borrow', sub: 'repay' }, nowMs) : { units: 0, quality: 'rule' as Quality };
  const aPx = price(live.assetUsd, p.assetUsd, p.asset.symbol, events);
  const dPx = p.debtAsset ? price(live.debtUsd, p.debtUsd, p.debtAsset.symbol, events) : { value: 0, quality: 'rule' as Quality };

  const valueUsd = bal.units * aPx.value;
  const debtUsd = debt.units * dPx.value;
  const netValueUsd = valueUsd - debtUsd;
  const pnlUsd = netValueUsd + W - C;

  if (missing) reasons.push(`${missing} رویداد نرخ دلاری ندارد؛ اثرش بر سود و زیان معلوم نیست.`);
  if (bal.quality === 'estimate') reasons.push('موجودی از روی نرخ فعلی برآورد شده، نه از موجودی خوانده‌شده از پروتکل.');
  if (bal.quality === 'missing') reasons.push('نه موجودی خوانده‌شده هست و نه نرخی؛ سود انباشته صفر نیست ولی معلوم نیست.');
  if (bal.quality === 'stale') reasons.push('آخرین موجودی خوانده‌شده بیش از یک هفته قدیمی است.');
  if (hasDebt && debt.quality !== 'manual') reasons.push('بدهی با نرخ وام برآورد شده؛ مقدار دقیق را از پروتکل بخوانید.');
  if (aPx.quality === 'missing') reasons.push(`قیمت دلاری ${p.asset.symbol} معلوم نیست.`);

  const G = valueUsd;
  const health = p.maxLtv && hasDebt && G > 0 ? { ltv: debtUsd / G, maxLtv: p.maxLtv, health: debtUsd > 0 ? (p.maxLtv * G) / debtUsd : Infinity } : null;
  const closed = bal.units < EPS && debt.units < EPS && events.some((e) => e.type === 'withdraw');

  return {
    balanceUnits: bal.units,
    balanceQuality: bal.quality,
    debtUnits: debt.units,
    debtQuality: debt.quality,
    assetUsd: aPx,
    debtAssetUsd: dPx,
    valueUsd,
    debtUsd,
    netValueUsd,
    contributionsUsd: C,
    withdrawalsUsd: W,
    pnlUsd,
    realizedUsd: realized,
    unrealizedUsd: pnlUsd - realized,
    rewardsUsd: rewards,
    feesUsd: fees,
    exitCostUsd: p.exitCostUsd,
    exitNowUsd: p.exitCostUsd === null ? null : netValueUsd - p.exitCostUsd,
    rateUsed: rate,
    borrowRateUsed: hasDebt ? borrowRate : null,
    missingRates: missing,
    incomplete: missing > 0 || bal.quality !== 'manual' || (hasDebt && debt.quality !== 'manual') || aPx.quality === 'missing',
    reasons,
    health,
    status: closed ? 'closed' : 'open',
  };
}

// ─── Continue or switch (report §7-3) ────────────────────────────────────────

const RISK: Partial<Record<OpportunityFamily, number>> = { lend: 1, vault: 1, 'fixed-lend': 1, pt: 1, stake: 2, lp: 3, leverage: 3 };

export interface SwitchAdvice {
  days: number;
  /** Income from keeping the position for `days` at today's rates, USD. */
  continueUsd: number | null;
  best: { e: Estimate; o: Opportunity } | null;
  /** Alternative net − continue − exit cost of the current position. */
  advantageUsd: number | null;
  /** Days for the rate advantage to repay the exit and entry costs. */
  breakEvenDays: number | null;
  verdict: 'switch' | 'stay' | 'unknown';
  why: string[];
}

/**
 * «ادامه یا خروج»: compares keeping the position with the best alternative for
 * the same money and the same period. A switch is suggested only when it pays
 * back its exit and entry costs within the period and the alternative is not a
 * riskier family — a small rate difference alone is never a reason.
 */
export function switchAdvice(p: EarnPosition, v: EarnValuation, alternatives: { e: Estimate; o: Opportunity }[], days: number): SwitchAdvice {
  const why: string[] = [];
  const out = (x: Partial<SwitchAdvice>): SwitchAdvice => ({ days, continueUsd: null, best: null, advantageUsd: null, breakEvenDays: null, verdict: 'unknown', why, ...x });
  if (v.status === 'closed') return out({ why: ['این پوزیشن بسته شده است.'] });
  if (v.rateUsed === null) return out({ why: ['نرخ فعلی این پوزیشن معلوم نیست؛ نرخ دستی وارد کنید.'] });
  if (!Number.isFinite(v.netValueUsd) || v.netValueUsd <= 0) return out({ why: ['ارزش فعلی معلوم نیست.'] });
  if (v.exitCostUsd === null) why.push('هزینه‌ی خروج وارد نشده؛ صفر فرض نشد و مقایسه ناقص است.');

  const continueUsd = v.valueUsd * growth(v.rateUsed, days) - (v.borrowRateUsed !== null ? v.debtUsd * growth(v.borrowRateUsed, days) : 0);
  const candidates = alternatives.filter((a) => a.o.key !== p.opportunityKey && a.e.net !== null && a.e.placement === 'ranked');
  const best = candidates.sort((a, b) => (b.e.net ?? 0) - (a.e.net ?? 0))[0] ?? null;
  if (!best) return out({ continueUsd, why: [...why, 'جایگزین واجد شرایطی برای این مبلغ و مدت پیدا نشد.'] });

  const exit = v.exitCostUsd ?? 0;
  const advantageUsd = (best.e.net as number) - continueUsd - exit;
  const entry = best.e.costs.filter((c) => c.key.startsWith('gas-entry')).reduce((a, c) => a + c.usd, 0);
  const dailyEdge = ((best.e.net as number) + entry - continueUsd) / days;
  const breakEvenDays = dailyEdge > 0 ? (exit + entry) / dailyEdge : null;
  const threshold = Math.max(1, v.netValueUsd * 0.001);
  const riskier = (RISK[best.o.family] ?? 3) > (RISK[p.family as OpportunityFamily] ?? 3);

  let verdict: SwitchAdvice['verdict'] = 'stay';
  if (v.exitCostUsd === null) verdict = 'unknown';
  else if (advantageUsd <= threshold) why.push('مزیت جایگزین پس از هزینه‌ها ناچیز یا منفی است؛ تفاوت کوچک نرخ دلیل جابه‌جایی نیست.');
  else if (breakEvenDays === null || breakEvenDays >= days) why.push('هزینه‌ی خروج و ورود در این مدت جبران نمی‌شود.');
  else if (riskier) why.push('جایگزین از نوع پرریسک‌تری است؛ فقط اگر آن ریسک را می‌پذیرید جابه‌جا شوید.');
  else verdict = 'switch';
  if (v.incomplete) why.push('ارزش فعلی برآورد ناقص است؛ پیش از تصمیم موجودی را از پروتکل بخوانید.');
  return { days, continueUsd, best, advantageUsd, breakEvenDays, verdict, why };
}

// ─── Storage ─────────────────────────────────────────────────────────────────

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const FAMILIES = new Set<EarnFamily>(['lend', 'vault', 'fixed-lend', 'leverage', 'lp', 'borrow']);
const TYPES = new Set(['deposit', 'withdraw', 'claim_reward', 'borrow', 'repay']);
const numOrNull = (x: unknown) => (isNum(x) ? x : null);
const mark = (x: unknown): Mark | null => (isObj(x) && isNum(x.amount) && isStr(x.at) && Number.isFinite(new Date(x.at).getTime()) ? { amount: x.amount, at: x.at } : null);

export function isEarnEvent(x: unknown): x is EarnEvent {
  return (
    isObj(x) &&
    isStr(x.id) &&
    isStr(x.type) &&
    TYPES.has(x.type) &&
    isStr(x.at) &&
    Number.isFinite(new Date(x.at).getTime()) &&
    isObj(x.cash) &&
    isNum(x.cash.amount) &&
    x.cash.amount >= 0 &&
    isStr(x.cash.token) &&
    (x.cash.usdRate === null || isNum(x.cash.usdRate)) &&
    Array.isArray(x.fees)
  );
}

/** A stored or imported earn position, with fields added later filled in; null when invalid. */
export function normalizeEarn(x: unknown): EarnPosition | null {
  if (!isObj(x) || !isStr(x.id) || !FAMILIES.has(x.family as EarnFamily)) return null;
  if (!isObj(x.asset) || !isStr(x.asset.symbol)) return null;
  if (!Array.isArray(x.events) || !x.events.every(isEarnEvent)) return null;
  const p = x as unknown as EarnPosition;
  const now = new Date().toISOString();
  return {
    id: p.id,
    createdAt: isStr(p.createdAt) ? p.createdAt : now,
    updatedAt: isStr(p.updatedAt) ? p.updatedAt : now,
    family: p.family,
    protocol: isObj(p.protocol) && isStr(p.protocol.name) ? { id: isStr(p.protocol.id) ? p.protocol.id : p.protocol.name.toLowerCase(), name: p.protocol.name, version: isStr(p.protocol.version) ? p.protocol.version : null } : { id: 'manual', name: '—', version: null },
    chain: isStr(p.chain) ? p.chain : '',
    market: isObj(p.market) && isStr(p.market.name) ? { id: isStr(p.market.id) ? p.market.id : p.market.name, name: p.market.name, address: isStr(p.market.address) ? p.market.address : null } : { id: p.id, name: p.asset.symbol, address: null },
    opportunityKey: isStr(p.opportunityKey) ? p.opportunityKey : null,
    asset: { symbol: p.asset.symbol, address: isStr(p.asset.address) ? p.asset.address : null },
    debtAsset: isObj(p.debtAsset) && isStr(p.debtAsset.symbol) ? { symbol: p.debtAsset.symbol, address: isStr(p.debtAsset.address) ? p.debtAsset.address : null } : null,
    maturity: isStr(p.maturity) && Number.isFinite(new Date(p.maturity).getTime()) ? p.maturity : null,
    manualRate: numOrNull(p.manualRate),
    manualBorrowRate: numOrNull(p.manualBorrowRate),
    maxLtv: isNum(p.maxLtv) && p.maxLtv > 0 && p.maxLtv < 1 ? p.maxLtv : null,
    balance: mark(p.balance),
    debt: mark(p.debt),
    assetUsd: numOrNull(p.assetUsd),
    debtUsd: numOrNull(p.debtUsd),
    exitCostUsd: numOrNull(p.exitCostUsd),
    events: p.events.map((e) => ({ ...e, note: isStr(e.note) ? e.note : '', fees: (e.fees ?? []).map((f) => ({ ...f, included: !!f.included, kind: f.kind ?? 'other', rateSource: f.rateSource ?? 'unknown' })), cash: { ...e.cash, rateSource: e.cash.rateSource ?? 'unknown' } })),
    note: isStr(p.note) ? p.note : '',
  };
}

/** A new position from a ranking row: identity, family and rate link carried over. */
export function earnFromOpportunity(o: Opportunity, id: string, at = new Date().toISOString()): EarnPosition | null {
  const family = o.family === 'pt' || o.family === 'yt' || o.family === 'stake' ? null : (o.family as EarnFamily);
  if (!family) return null;
  const asset = o.assets.deposit[0];
  const debt = o.loop?.debt.token ?? null;
  return {
    id,
    createdAt: at,
    updatedAt: at,
    family,
    protocol: { id: o.protocol.id, name: o.protocol.name, version: o.protocol.version },
    chain: o.chain,
    market: { id: o.market.id, name: o.market.name, address: o.market.address },
    opportunityKey: o.key,
    asset: { symbol: asset?.symbol ?? '—', address: asset?.address ?? null },
    debtAsset: debt?.symbol ? { symbol: debt.symbol, address: debt.address } : null,
    maturity: o.maturity,
    manualRate: null,
    manualBorrowRate: null,
    maxLtv: o.loop?.maxLtv ?? null,
    balance: null,
    debt: null,
    assetUsd: null,
    debtUsd: null,
    exitCostUsd: null,
    events: [],
    note: '',
  };
}
