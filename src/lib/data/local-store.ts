/** Browser storage that never throws (private windows, blocked storage, SSR). */
export function readLocal<T>(key: string, fallback: T): T {
  try {
    if (typeof window === 'undefined') return fallback;
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeLocal(key: string, value: unknown): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable — state simply isn't persisted */
  }
}

export const STORAGE_KEYS = {
  draft: 'yieldx-draft-v2',
  scenarios: 'yieldx-scenarios-v2',
  alerts: 'yieldx-alerts-v2',
  onboarded: 'yieldx-onboarded',
} as const;
