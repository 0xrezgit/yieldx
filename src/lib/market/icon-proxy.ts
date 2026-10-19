/**
 * Logo hosts the browser cannot always reach: Google Cloud Storage (Pendle's icons)
 * answers «not available in your location» (403) in some countries, so those logos go
 * through /api/icon on the server. Only these prefixes — never an open proxy.
 */
const PROXIED = ['https://storage.googleapis.com/prod-pendle-bucket-a/'];

export const isProxiedIcon = (url: string) => PROXIED.some((p) => url.startsWith(p));

/** The URL the browser loads: the server route for a proxied host, otherwise unchanged. */
export const iconSrc = (url: string) => (isProxiedIcon(url) ? `/api/icon?u=${encodeURIComponent(url)}` : url);
