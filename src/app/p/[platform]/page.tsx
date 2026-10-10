import { redirect } from 'next/navigation';

/** Old platform page: the market analysis is no longer split by platform. */
export default function OldPlatformPage() {
  redirect('/');
}
