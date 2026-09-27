'use client';

import { useSyncExternalStore } from 'react';

/** Below this width the app uses the mobile / PWA layout. */
const QUERY = '(max-width: 1023px)';

function subscribe(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false,
  );
}
