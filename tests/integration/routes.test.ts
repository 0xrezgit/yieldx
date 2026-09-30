import { describe, expect, it, vi } from 'vitest';

// next/navigation's redirect throws; here it records the target instead.
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error('redirect'), { url });
  },
}));

const target = async (fn: () => unknown) => {
  try {
    await fn();
  } catch (e) {
    return (e as { url?: string }).url;
  }
  return null;
};

describe('old addresses lead to the two sections, never to a broken page', () => {
  it('sends old sections to the market analysis', async () => {
    for (const r of ['ranking', 'lending', 'stable', 'merkl']) {
      const { default: Page } = await import(`../../src/app/opportunities/${r}/page`);
      expect(await target(() => Page())).toBe('/');
    }
  });

  it('keeps a saved LP / YT / calculator link on the specialist tools, with its query', async () => {
    const { default: Page } = await import('../../src/app/opportunities/page');
    expect(await target(() => Page({ searchParams: Promise.resolve({ tab: 'lp', a: 'USDC', fee: '12' }) }))).toBe('/tools?tab=lp&a=USDC&fee=12');
    expect(await target(() => Page({ searchParams: Promise.resolve({ tab: 'rank' }) }))).toBe('/');
    expect(await target(() => Page({ searchParams: Promise.resolve({}) }))).toBe('/');
  });

  it('the installed app opens on the market analysis and keeps its identity', async () => {
    const { default: manifest } = await import('../../src/app/manifest');
    const m = manifest();
    expect(m.start_url).toBe('/');
    expect(m.id).toBe('/dashboard');
    expect(m.shortcuts!.map((s) => s.url)).toEqual(['/', '/portfolio']);
  });
});
