import 'server-only';
import type { Opportunity } from '../../types/opportunity';
import { robustFromPoints } from '../opportunity/robust-rate';

/**
 * Daily rate histories of the lending and vault sources, for the robust rate (see
 * `robust-rate.ts`). Kept here per opportunity key and refreshed in the background
 * every `TTL_MS`: the feed never waits for them, and a market whose history is not in
 * yet keeps its source's own averages (`avg7d`, `avg1d`).
 */

/** Points: unix ms, rate in % a year. */
export type HistoryPoints = { t: number; v: number | null }[];
export type HistoryLoader = (list: Opportunity[]) => Promise<Map<string, HistoryPoints>>;

const TTL_MS = 6 * 3_600_000;
const RETRY_MS = 30 * 60_000;

const store = new Map<string, HistoryPoints>();
const lastRun = new Map<string, { at: number; ok: boolean }>();
const running = new Map<string, Promise<void>>();

/** Histories still being fetched, for the route to keep alive after answering. */
export const pendingHistories = (): Promise<unknown> | null => (running.size ? Promise.all(running.values()) : null);

/**
 * The list with each opportunity's robust rate from the stored history; starts a refresh
 * in the background when due. `adjust` maps a stored % to the rate's own basis (e.g. a
 * history that includes rewards, for a rate that does not).
 */
export function withHistory(sourceId: string, list: Opportunity[], load: HistoryLoader, adjust?: (o: Opportunity, pct: number) => number, now = Date.now()): Opportunity[] {
  const last = lastRun.get(sourceId);
  const due = !last || now - last.at > (last.ok ? TTL_MS : RETRY_MS);
  if (due && !running.has(sourceId) && list.length) {
    lastRun.set(sourceId, { at: now, ok: false });
    const job = load(list)
      .then((m) => {
        for (const [k, v] of m) store.set(k, v);
        lastRun.set(sourceId, { at: Date.now(), ok: true });
      })
      .catch(() => {})
      .finally(() => running.delete(sourceId));
    running.set(sourceId, job);
  }
  return list.map((o) => {
    const points = store.get(o.key);
    if (!points) return o;
    const robust = robustFromPoints(points, adjust ? (v) => adjust(o, v) : (v) => v);
    return robust ? { ...o, rate: { ...o.rate, robust } } : o;
  });
}

/** Test hook. */
export function resetHistories() {
  store.clear();
  lastRun.clear();
  running.clear();
}
