import { renderAppIcon } from '../../../lib/pwa-icon';

const SIZES = ['192', '512'];

export const dynamicParams = false;

export function generateStaticParams() {
  return SIZES.map((size) => ({ size }));
}

/** Stable PNG icon URLs for the web app manifest: /pwa-icon/192, /pwa-icon/512. */
export async function GET(_request: Request, { params }: { params: Promise<{ size: string }> }) {
  const { size } = await params;
  return renderAppIcon(Number(size));
}
