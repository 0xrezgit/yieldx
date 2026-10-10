import { redirect } from 'next/navigation';

/** Old strategy page: the PT loop is a view of the market analysis; PT is in the ranking. */
export default async function OldStrategyPage({ params }: { params: Promise<{ strategy: string }> }) {
  const { strategy } = await params;
  redirect(strategy === 'loop' ? '/?view=loop' : '/');
}
