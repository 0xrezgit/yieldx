import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

interface CardProps {
  title?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** Rounded surface with an optional one-line header. */
export function Card({ title, icon, actions, children, className = '' }: CardProps) {
  return (
    <section className={`sx-card p-4 md:p-6 min-w-0 flex flex-col gap-4 ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 min-w-0">
          {title && (
            <h2 className="text-base font-semibold text-primary flex items-center gap-2 min-w-0">
              {icon && <span className="shrink-0 text-accent">{icon}</span>}
              <span className="truncate">{title}</span>
            </h2>
          )}
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** Card whose body opens on tap — for secondary sections. */
export function Collapsible({
  title,
  icon,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon?: ReactNode;
  badge?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="group sx-card min-w-0">
      <summary className="flex items-center justify-between gap-3 px-4 md:px-6 py-3.5 min-h-13 rounded-2xl hover:bg-raised/50 transition-colors">
        <span className="text-[15px] font-medium text-primary flex items-center gap-2 min-w-0">
          {icon && <span className="shrink-0 text-accent">{icon}</span>}
          <span className="truncate">{title}</span>
          {badge}
        </span>
        <ChevronDown size={18} className="text-muted transition-transform group-open:rotate-180 shrink-0" />
      </summary>
      <div className="px-4 md:px-6 pb-5 pt-1 flex flex-col gap-4">{children}</div>
    </details>
  );
}
