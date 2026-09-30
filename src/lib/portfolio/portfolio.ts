import type { Position, PortfolioFile, PortfolioSnapshot, PositionEvent, ValueSnapshot } from '../../types/position';
import { emptyManual, emptyTargets } from '../../types/position';
import protocols from '../../config/protocols.json';
import type { Valuation } from './valuation';
import type { AirdropProgram } from '../../types/airdrop';
import { normalizeProgram } from './airdrop';
import { normalizeEarn } from './earn';
import type { EarnPosition } from '../../types/earn';

/** Portfolio totals, allocation and the snapshot/backup plumbing. */

export interface PortfolioTotals {
  netValueUsd: number;
  investedUsd: number;
  pnlUsd: number;
  pnlPct: number;
  realizedUsd: number;
  unrealizedUsd: number;
  incomeUsd: number;
  feesUsd: number;
  debtUsd: number;
  /** Positions left out of USD totals because a price is missing. */
  unpriced: number;
}

export function portfolioTotals(items: { v: Valuation }[]): PortfolioTotals {
  const t: PortfolioTotals = {
    netValueUsd: 0,
    investedUsd: 0,
    pnlUsd: 0,
    pnlPct: NaN,
    realizedUsd: 0,
    unrealizedUsd: 0,
    incomeUsd: 0,
    feesUsd: 0,
    debtUsd: 0,
    unpriced: 0,
  };
  for (const { v } of items) {
    const L = v.ledger;
    t.incomeUsd += L.incomeYieldUsd + L.incomeRewardUsd;
    t.feesUsd += L.fees.total + L.interestPaidUsd;
    t.investedUsd += Math.max(0, v.investedUsd);
    if (!Number.isFinite(v.pnlUsd) || !Number.isFinite(v.netValueUsd)) {
      t.unpriced++;
      t.realizedUsd += L.realizedUsd;
      continue;
    }
    t.netValueUsd += v.netValueUsd;
    t.pnlUsd += v.pnlUsd;
    t.realizedUsd += v.realizedUsd;
    t.unrealizedUsd += v.unrealizedUsd;
    t.debtUsd += Number.isFinite(v.debtUsd.value) ? v.debtUsd.value : 0;
  }
  // % only over positions whose P&L is known, so unpriced capital doesn't dilute it.
  const capital = items.reduce((s, { v }) => s + (Number.isFinite(v.pnlUsd) ? Math.max(0, v.investedUsd) : 0), 0);
  t.pnlPct = capital > 0 ? (t.pnlUsd / capital) * 100 : NaN;
  return t;
}

export interface Slice {
  key: string;
  valueUsd: number;
  share: number;
}

/** Share of open net value by a grouping key. */
export function allocation<T extends { p: Position; v: Valuation }>(items: T[], key: (x: T) => string): Slice[] {
  const map = new Map<string, number>();
  let total = 0;
  for (const x of items) {
    if (x.v.status === 'closed' || !Number.isFinite(x.v.netValueUsd) || x.v.netValueUsd <= 0) continue;
    map.set(key(x), (map.get(key(x)) ?? 0) + x.v.netValueUsd);
    total += x.v.netValueUsd;
  }
  return [...map.entries()]
    .map(([k, valueUsd]) => ({ key: k, valueUsd, share: total > 0 ? (valueUsd / total) * 100 : 0 }))
    .sort((a, b) => b.valueUsd - a.valueUsd);
}

/** Herfindahl index of shares (0–10 000): above 2 500 is highly concentrated. */
export const concentration = (slices: Slice[]) => slices.reduce((s, x) => s + x.share * x.share, 0);

// ─── Snapshots: only real, app-computed valuations; gaps stay gaps ────────────

const SNAPSHOT_EVERY_MS = 60 * 60_000;
const MAX_SNAPSHOTS = 2000;

export function appendSnapshot<T extends { at: string }>(list: T[], snap: T, every = SNAPSHOT_EVERY_MS): T[] {
  const last = list[list.length - 1];
  if (last && new Date(snap.at).getTime() - new Date(last.at).getTime() < every) return list;
  return [...list, snap].slice(-MAX_SNAPSHOTS);
}

export const positionSnapshot = (v: Valuation, at: string): ValueSnapshot => ({ at, valueUsd: v.netValueUsd, pnlUsd: v.pnlUsd });
export const portfolioSnapshot = (t: PortfolioTotals, at: string): PortfolioSnapshot => ({
  at,
  netValueUsd: t.netValueUsd,
  investedUsd: t.investedUsd,
  pnlUsd: t.pnlUsd,
});

// ─── Backup file validation ──────────────────────────────────────────────────

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const EVENT_TYPES = new Set(['buy', 'sell', 'redeem', 'claim_yield', 'claim_reward', 'borrow', 'repay']);

function isAmount(x: unknown): boolean {
  return isObj(x) && isNum(x.amount) && isStr(x.token) && (x.usdRate === null || isNum(x.usdRate));
}

export function isEvent(x: unknown): x is PositionEvent {
  return (
    isObj(x) &&
    isStr(x.id) &&
    isStr(x.type) &&
    EVENT_TYPES.has(x.type) &&
    isStr(x.at) &&
    Number.isFinite(new Date(x.at).getTime()) &&
    isNum(x.units) &&
    x.units >= 0 &&
    isAmount(x.cash) &&
    Array.isArray(x.fees) &&
    x.fees.every(isAmount)
  );
}

/** Accepts a stored/imported position, filling fields added in later versions. */
export function normalizePosition(x: unknown): Position | null {
  if (!isObj(x)) return null;
  if (!isStr(x.id) || !isStr(x.marketId) || !isStr(x.maturity) || !isStr(x.protocol)) return null;
  if (!(x.protocol in protocols)) return null;
  if (x.kind !== 'pt' && x.kind !== 'yt' && x.kind !== 'loop') return null;
  if (!Array.isArray(x.events) || !x.events.every(isEvent)) return null;
  const p = x as unknown as Position;
  return {
    ...p,
    chain: p.chain ?? '',
    marketName: p.marketName ?? p.marketId,
    platform: p.platform ?? '',
    icon: p.icon ?? '',
    assetSymbol: p.assetSymbol ?? '',
    events: p.events.map((e) => ({ ...e, assetUsd: e.assetUsd ?? null, assetUsdSource: e.assetUsdSource ?? 'unknown', note: e.note ?? '', fees: e.fees.map((f) => ({ ...f, included: !!f.included, kind: f.kind ?? 'other', rateSource: f.rateSource ?? 'unknown' })) })),
    loop: p.kind === 'loop' ? p.loop ?? null : null,
    manual: { ...emptyManual(), ...(p.manual ?? {}) },
    targets: { ...emptyTargets(), ...(p.targets ?? {}) },
    points: { perDay: 0, multiplier: 1, basis: 'unit', valuePerPoint: 0, ...(p.points ?? {}) },
    snapshots: Array.isArray(p.snapshots) ? p.snapshots.filter((s) => isObj(s) && isStr(s.at) && isNum(s.valueUsd)) : [],
    note: p.note ?? '',
    createdAt: p.createdAt ?? new Date().toISOString(),
    updatedAt: p.updatedAt ?? new Date().toISOString(),
  };
}

export function parseBackup(text: string): PortfolioFile | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isObj(raw) || (raw.version !== 1 && raw.version !== 2) || !Array.isArray(raw.positions)) return null;
  const positions = raw.positions.map(normalizePosition);
  if (positions.some((p) => p === null)) return null;
  const history = Array.isArray(raw.history) ? (raw.history.filter((s) => isObj(s) && isStr(s.at) && isNum(s.netValueUsd)) as PortfolioSnapshot[]) : [];
  const airdrops = Array.isArray(raw.airdrops) ? raw.airdrops.map(normalizeProgram) : [];
  if (airdrops.some((a) => a === null)) return null;
  const earn = Array.isArray(raw.earn) ? raw.earn.map(normalizeEarn) : [];
  if (earn.some((e) => e === null)) return null;
  return { version: 2, exportedAt: isStr(raw.exportedAt) ? raw.exportedAt : '', positions: positions as Position[], history, airdrops: airdrops as AirdropProgram[], earn: earn as EarnPosition[] };
}

/** Merge imported airdrop records: same id → imported copy wins. */
export function mergeAirdrops(current: AirdropProgram[], imported: AirdropProgram[] = []): AirdropProgram[] {
  const byId = new Map(current.map((a) => [a.id, a]));
  for (const a of imported) byId.set(a.id, a);
  return [...byId.values()];
}

/** Merge imported earn positions: same id → imported copy wins. */
export function mergeEarn(current: EarnPosition[], imported: EarnPosition[] = []): EarnPosition[] {
  const byId = new Map(current.map((p) => [p.id, p]));
  for (const p of imported) byId.set(p.id, p);
  return [...byId.values()];
}

/** Merge an imported backup: positions with the same id are replaced by the imported copy. */
export function mergeBackup(current: Position[], file: PortfolioFile): Position[] {
  const byId = new Map(current.map((p) => [p.id, p]));
  for (const p of file.positions) byId.set(p.id, p);
  return [...byId.values()];
}

export const newId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
