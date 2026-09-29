'use client';

import { useEffect, useState } from 'react';
import { fetchCoinPrices, type TokenPrice } from '../lib/data/market-data';
import { networkByName } from '../lib/registry/networks';

const cache = new Map<string, TokenPrice | null>();

/** DefiLlama coin id for a token on a network, or null when it can't be priced automatically. */
export function coinId(chain: string, address: string | null | undefined): string | null {
  const slug = networkByName(chain).llama;
  const a = address?.trim();
  return slug && a && /^[A-Za-z0-9]{20,64}$/.test(a) ? `${slug}:${a}` : null;
}

/**
 * USD price of a token by contract address: current (atMs undefined) or at a past
 * moment. Null while loading, when the network has no price source, or when the
 * price service doesn't know the token — the caller then asks for a manual price.
 */
export function useCoinPrice(chain: string, address: string | null | undefined, atMs?: number): TokenPrice | null {
  const id = coinId(chain, address);
  const bucket = atMs === undefined ? `now-${Math.floor(Date.now() / 300_000)}` : String(Math.floor(atMs / 60_000));
  const key = id ? `${id}|${bucket}` : null;
  const [, force] = useState(0);
  useEffect(() => {
    if (!key || !id || cache.has(key)) return;
    const ctrl = new AbortController();
    fetchCoinPrices([id], atMs, ctrl.signal)
      .then((p) => {
        cache.set(key, p[id] ?? null);
        force((n) => n + 1);
      })
      .catch(() => {
        if (!ctrl.signal.aborted) {
          cache.set(key, null);
          force((n) => n + 1);
        }
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key covers id and time
  }, [key]);
  return key ? cache.get(key) ?? null : null;
}
