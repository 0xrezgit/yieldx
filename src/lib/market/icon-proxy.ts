/**
 * Logo hosts the browser cannot always reach, so those logos go through /api/icon on the
 * server (cached a week). Only these prefixes — never an open proxy.
 * - Google Cloud Storage (Pendle's icons, and the money-market logos PendleLoop links) answers «not available in your location» (403)
 *   in some countries.
 * - Euler's token images and Upshift's (Cloudflare Images) answer 403 to a burst: a page
 *   with dozens of Euler logos loses some of them.
 */
const PROXIED = ['https://storage.googleapis.com/prod-pendle-bucket-a/', 'https://storage.googleapis.com/external-integration-prod/', 'https://v3.euler.finance/v3/images/tokens/', 'https://imagedelivery.net/JKqfgGWnlUbSJb3LhpWg6w/'];

export const isProxiedIcon = (url: string) => PROXIED.some((p) => url.startsWith(p));

/** The URL the browser loads: the server route for a proxied host, otherwise unchanged. */
export const iconSrc = (url: string) => (isProxiedIcon(url) ? `/api/icon?u=${encodeURIComponent(url)}` : url);
