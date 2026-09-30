import { redirect } from 'next/navigation';

const TOOL_TABS = new Set(['yt', 'calc', 'lp']);

/**
 * Old address of «فرصت‌ها». Links to a specialist tab (LP analysis from a saved link,
 * the YT board, the calculator) keep their query on /tools; everything else is the
 * market analysis now.
 */
export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const tab = typeof params.tab === 'string' ? params.tab : '';
  if (TOOL_TABS.has(tab)) {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (typeof v === 'string') q.set(k, v);
    redirect(`/tools?${q}`);
  }
  redirect('/');
}
