'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppHeader } from './AppHeader';
import { BottomNav } from './BottomNav';

export type MobileTab = 'market' | 'result' | 'alerts';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

interface ShellState {
  tab: MobileTab;
  setTab: (t: MobileTab) => void;
  /** Number of warnings to show on the alerts tab. */
  alertCount: number;
  setAlertCount: (n: number) => void;
  /** Present only when the browser offers a PWA install prompt. */
  install: (() => void) | null;
}

export const ShellContext = createContext<ShellState | null>(null);

export function useShell(): ShellState {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShell must be used inside <AppShell>');
  return ctx;
}

/** App frame: header, mobile bottom bar, PWA service worker and install prompt. */
export function AppShell({ children }: { children: ReactNode }) {
  const [tab, setTabState] = useState<MobileTab>('market');
  const [alertCount, setAlertCount] = useState(0);
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);

  const setTab = useCallback((t: MobileTab) => {
    setTabState(t);
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    if ('serviceWorker' in navigator && process.env.NODE_ENV === 'production') {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPromptEvent(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setPromptEvent(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const value = useMemo<ShellState>(
    () => ({
      tab,
      setTab,
      alertCount,
      setAlertCount,
      install: promptEvent
        ? () => {
            promptEvent.prompt();
            promptEvent.userChoice.finally(() => setPromptEvent(null));
          }
        : null,
    }),
    [tab, setTab, alertCount, promptEvent],
  );

  return (
    <ShellContext.Provider value={value}>
      <AppHeader />
      <div className="pb-safe lg:pb-0">{children}</div>
      <BottomNav />
    </ShellContext.Provider>
  );
}
