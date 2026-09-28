import type { ReactNode } from 'react';
import { DOLLAR } from '../../lib/utils/formatting';

const WITH_UNIT = new RegExp(`^(.*)\\s(${DOLLAR})$`, 's');

/**
 * Isolates a formatted number (LTR) inside RTL text so signs and symbols stay put.
 * A trailing «دلار» (from formatUSD) is kept outside the LTR run, so it reads
 * after the number: «۱۲٫۵ دلار».
 */
export function Num({ children, className = '' }: { children: ReactNode; className?: string }) {
  const m = typeof children === 'string' ? WITH_UNIT.exec(children) : null;
  if (m) {
    return (
      <span className={`num whitespace-nowrap ${className}`}>
        <bdi dir="ltr">{m[1]}</bdi> <span className="text-[0.78em] font-light opacity-75">{m[2]}</span>
      </span>
    );
  }
  return (
    <bdi dir="ltr" className={`num ${className}`}>
      {children}
    </bdi>
  );
}
