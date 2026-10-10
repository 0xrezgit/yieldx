import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('server-only', () => ({}));

/** A stand-in for postgres.js: records every statement and its values; SELECT returns `rows`. */
const calls: { text: string; values: unknown[] }[] = [];
let rows: { kind: string; key: string; value: unknown }[] = [];
vi.mock('postgres', () => ({
  default: () => {
    const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?').replace(/\s+/g, ' ').trim();
      calls.push({ text, values });
      return Promise.resolve(text.startsWith('SELECT') ? rows : []);
    };
    return sql;
  },
}));

afterEach(() => {
  calls.length = 0;
  rows = [];
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const source = (values: Record<string, unknown>) => ({
  all: () => ({ results: [], prices: Object.entries(values) as [string, number | null][], addresses: [], blocks: [] }),
  one: (_kind: string, key: string) => values[key],
});

describe('verification store on Postgres (Neon)', () => {
  it('creates its table on first use and loads every kind back', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://x');
    const { createStore } = await import('../../src/lib/llama/verify-store');
    rows = [
      { kind: 'result', key: 'pool-1', value: { day: 1, at: 2, outcome: { ok: false, reason: 'young' } } },
      { kind: 'price', key: '1:0xv:100', value: 1.02 },
      { kind: 'block', key: 'ethereum:1760054400000', value: 23_000_000 },
    ];
    const loaded = await createStore(source({})).load();
    expect(calls[0].text).toContain('CREATE TABLE IF NOT EXISTS verify_cache');
    expect(loaded?.results).toEqual([['pool-1', rows[0].value]]);
    expect(loaded?.prices).toEqual([['1:0xv:100', 1.02]]);
    expect(loaded?.blocks).toEqual([['ethereum:1760054400000', 23_000_000]]);
  });

  it('writes only the entries that changed, as JSON, in one upsert', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://x');
    const { createStore } = await import('../../src/lib/llama/verify-store');
    const store = createStore(source({ a: 1.5, b: null, c: 9 }));
    store.mark('price', 'a');
    store.mark('price', 'b');
    await store.flush();
    const insert = calls.find((c) => c.text.startsWith('INSERT INTO verify_cache'))!;
    expect(insert.text).toContain('ON CONFLICT (kind, key) DO UPDATE');
    expect(insert.values.slice(1, 4)).toEqual([['price', 'price'], ['a', 'b'], ['1.5', 'null']]);
    // Nothing changed since: no second write.
    calls.length = 0;
    await store.flush();
    expect(calls.some((c) => c.text.startsWith('INSERT'))).toBe(false);
  });

  it('a store that cannot be read is no error: memory only', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://x');
    const mod = await import('postgres');
    const spy = vi.spyOn(mod, 'default');
    spy.mockImplementationOnce((() => () => Promise.reject(new Error('down'))) as never);
    const { createStore } = await import('../../src/lib/llama/verify-store');
    await expect(createStore(source({})).load()).resolves.toBeNull();
  });
});
