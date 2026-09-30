import { redirect } from 'next/navigation';

/** Old address of the lending section, now part of the unified ranking. */
export default function LendingPage() {
  redirect('/opportunities/ranking');
}
