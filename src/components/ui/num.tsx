import type { ReactNode } from 'react';
import { DOLLAR } from '../../lib/utils/formatting';

/** Persian/Arabic letters (not digits or number punctuation). */
const WORDS = /[\u0621-\u063A\u0641-\u064A\u067E\u0686\u0698\u06A9\u06AF\u06CC\u06C0]/;
/** A signed number run with its own symbols: «−۱۲٬۳۴۵٫۶۷», «+۳٫۲۵٪», «۲×». */
const NUMBER = /([−+-]?[۰-۹0-9][۰-۹0-9٬٫,.]*[٪%×]?)/g;
const ISOLATES = /[\u2066-\u2069]/g;

/**
 * Isolates formatted numbers (LTR) inside RTL text so signs and symbols stay put.
 * Text that also contains Persian words («۱۲٫۵ میلیون دلار», «بیش از ۱٬۰۰۰٪») stays
 * RTL and only its numeric runs are isolated — so words never swap places. A trailing
 * «دلار» is set a little smaller, after the number.
 */
export function Num({ children, className = '' }: { children: ReactNode; className?: string }) {
  if (typeof children === 'string' && WORDS.test(children)) {
    const text = children.replace(ISOLATES, '');
    const unit = text.endsWith(` ${DOLLAR}`);
    const body = unit ? text.slice(0, -DOLLAR.length - 1) : text;
    const parts = body.split(NUMBER);
    return (
      <span className={`num whitespace-nowrap ${className}`}>
        {parts.map((p, i) =>
          i % 2 === 1 ? (
            <bdi key={i} dir="ltr">
              {p}
            </bdi>
          ) : (
            p
          ),
        )}
        {unit && (
          <>
            {' '}
            <span className="text-[max(12px,0.8em)] font-normal text-secondary">{DOLLAR}</span>
          </>
        )}
      </span>
    );
  }
  return (
    <bdi dir="ltr" className={`num ${className}`}>
      {children}
    </bdi>
  );
}
