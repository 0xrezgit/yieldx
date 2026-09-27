import type { ReactNode } from 'react';

/** Isolates a formatted number (LTR) inside RTL text so signs and symbols stay put. */
export function Num({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={`num ${className}`}>
      {children}
    </bdi>
  );
}
