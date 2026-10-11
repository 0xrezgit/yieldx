import { redirect } from 'next/navigation';

/**
 * Old address of the PT/YT calculator. There is one calculator now, in «ابزارها» (real
 * protocol fees, gas, LP, Mint / Redeem): a link with a market opens it on that market.
 */
export default async function OldCalculator({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const p = await searchParams;
  const one = (k: string) => (typeof p[k] === 'string' ? (p[k] as string) : null);
  const q = new URLSearchParams({ tab: 'calc' });
  for (const k of ['protocol', 'market', 'name']) {
    const v = one(k);
    if (v) q.set(k, v);
  }
  redirect(`/tools?${q}`);
}
