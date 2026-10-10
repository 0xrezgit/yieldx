import 'server-only';
import { mkdirSync, readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import postgres from 'postgres';

/**
 * Lasting copy of the on-chain verification (results, share prices, vault addresses and
 * the block of each day), so a new server — a restart, or every cold start on Vercel —
 * does not redo ~25 calls for each of ~700 vaults: what was verified shows at once and
 * only the rest is worked on.
 *
 * - `DATABASE_URL` set (Neon on Vercel): table `verify_cache`, one row per entry; only
 *   the entries that changed are written, so instances running at once do not undo each
 *   other. The table is created on first use (drizzle/0002_create_verify_cache.sql).
 * - Otherwise (local): one JSON file in `YIELDX_CACHE_DIR` (default `.next/cache/yieldx`).
 *
 * Past prices and blocks never change; results carry their own day and are redone daily.
 * A store that cannot be read or written only means working from memory, never an error.
 */

export type Kind = 'result' | 'price' | 'address' | 'block';

export interface Stored<R> {
  results: [string, R][];
  prices: [string, number | null][];
  addresses: [string, { at: number; value: string | null }][];
  blocks: [string, number][];
}

/** What the server keeps in memory, read when a write happens. */
export interface Source<R> {
  all(): Stored<R>;
  /** One entry's current value; undefined when it should not be stored. */
  one(kind: Kind, key: string): unknown;
}

export interface Store<R> {
  load(): Promise<Stored<R> | null>;
  /** An entry changed: written with the next batch (at most every `SAVE_EVERY_MS`). */
  mark(kind: Kind, key: string): void;
  /** Writes what changed now (the end of a background run). */
  flush(): Promise<void>;
}

/** Bump when the stored shapes change: older data is ignored. */
const VERSION = 1;
const SAVE_EVERY_MS = 5_000;
/** Entries not touched for this long are dropped (the windows read at most 90 days back). */
const KEEP_DAYS = 150;
const KEEP_MS = KEEP_DAYS * 86_400_000;

const LIST: Record<Kind, keyof Stored<unknown>> = { result: 'results', price: 'prices', address: 'addresses', block: 'blocks' };

function batched(write: () => Promise<void>) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running: Promise<void> | null = null;
  const run = async () => {
    timer = null;
    if (running) await running;
    running = write()
      .catch(() => {})
      .finally(() => {
        running = null;
      });
    await running;
  };
  return {
    soon() {
      if (!timer) timer = setTimeout(run, SAVE_EVERY_MS);
    },
    async now() {
      if (timer) clearTimeout(timer);
      await run();
    },
  };
}

// ─── Postgres (Neon) ─────────────────────────────────────────────────────────

function pgStore<R>(url: string, src: Source<R>): Store<R> {
  // Neon's pooled endpoint (PgBouncer): no prepared statements; two connections are plenty.
  const sql = postgres(url, { prepare: false, max: 2, idle_timeout: 20, connect_timeout: 10 });
  let ready: Promise<void> | null = null;
  const ensure = () =>
    (ready ??= (async () => {
      await sql`CREATE TABLE IF NOT EXISTS verify_cache (
        kind text NOT NULL,
        key text NOT NULL,
        value jsonb,
        version integer NOT NULL DEFAULT 1,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (kind, key)
      )`;
      await sql`DELETE FROM verify_cache WHERE updated_at < now() - make_interval(days => ${KEEP_DAYS})`;
    })().catch((e) => {
      ready = null;
      throw e;
    }));

  const dirty = new Map<Kind, Set<string>>();
  const write = batched(async () => {
    if (!dirty.size) return;
    const rows: { kind: Kind; key: string; value: string }[] = [];
    for (const [kind, keys] of dirty) {
      for (const key of keys) {
        const v = src.one(kind, key);
        if (v !== undefined) rows.push({ kind, key, value: JSON.stringify(v) });
      }
    }
    dirty.clear();
    if (!rows.length) return;
    await ensure();
    for (let i = 0; i < rows.length; i += 500) {
      const part = rows.slice(i, i + 500);
      await sql`
        INSERT INTO verify_cache (kind, key, value, version)
        SELECT k, c, v, ${VERSION} FROM unnest(${part.map((r) => r.kind)}::text[], ${part.map((r) => r.key)}::text[], ${part.map((r) => r.value)}::jsonb[]) AS t(k, c, v)
        ON CONFLICT (kind, key) DO UPDATE SET value = excluded.value, version = excluded.version, updated_at = now()`;
    }
  });

  return {
    async load() {
      try {
        await ensure();
        const rows = await sql<{ kind: Kind; key: string; value: unknown }[]>`SELECT kind, key, value FROM verify_cache WHERE version = ${VERSION}`;
        const out: Stored<R> = { results: [], prices: [], addresses: [], blocks: [] };
        for (const r of rows) {
          const list = LIST[r.kind];
          if (list) (out[list] as [string, unknown][]).push([r.key, r.value]);
        }
        return out;
      } catch {
        return null;
      }
    },
    mark(kind, key) {
      dirty.set(kind, (dirty.get(kind) ?? new Set()).add(key));
      write.soon();
    },
    flush: () => write.now(),
  };
}

// ─── One file (local) ────────────────────────────────────────────────────────

function fileStore<R>(src: Source<R>): Store<R> {
  const dir = process.env.YIELDX_CACHE_DIR?.trim() || join(process.cwd(), '.next', 'cache', 'yieldx');
  const file = join(dir, 'verified.json');
  const write = batched(async () => {
    const s = src.all();
    const cutoff = Date.now() - KEEP_MS;
    // Block keys end in the day (unix ms): old days are no longer read.
    const blocks = s.blocks.filter(([k]) => Number(k.slice(k.lastIndexOf(':') + 1)) >= cutoff);
    mkdirSync(dir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ version: VERSION, ...s, blocks }));
    await rename(tmp, file);
  });
  return {
    async load() {
      try {
        const body = JSON.parse(readFileSync(file, 'utf8')) as Stored<R> & { version?: number };
        return body.version === VERSION ? body : null;
      } catch {
        return null;
      }
    },
    mark: () => write.soon(),
    flush: () => write.now(),
  };
}

/** Neon when `DATABASE_URL` is set, else the local file. */
export function createStore<R>(src: Source<R>): Store<R> {
  const url = process.env.DATABASE_URL?.trim();
  return url ? pgStore(url, src) : fileStore(src);
}
