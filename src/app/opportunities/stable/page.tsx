import type { Metadata } from 'next';
import StableSuggestions from '../../../components/stable/StableSuggestions';

export const metadata: Metadata = { title: 'پیشنهاد استیبل‌کوین — YieldX' };

export default function StablePage() {
  return <StableSuggestions />;
}
