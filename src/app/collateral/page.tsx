import type { Metadata } from 'next';
import CollateralStrategy from '../../components/collateral/CollateralStrategy';

export const metadata: Metadata = { title: 'وام با وثیقه — YieldX' };

export default function CollateralPage() {
  return <CollateralStrategy />;
}
