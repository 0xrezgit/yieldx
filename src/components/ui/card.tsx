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
    <section className={`bg-surface/80 border border-default rounded-2xl p-4 md:p-5 min-w-0 flex flex-col gap-4 ${className}`}>
      {(title || actions) && (
        <div className="flex items-center justify-between gap-3 min-w-0">
          {title && (
            <h2 className="font-bold text-primary flex items-center gap-2 min-w-0">
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
    <details open={defaultOpen} className="group bg-surface/80 border border-default rounded-2xl min-w-0">
      <summary className="flex items-center justify-between gap-3 p-4 md:p-5">
        <span className="font-bold text-primary flex items-center gap-2 min-w-0">
          {icon && <span className="shrink-0 text-accent">{icon}</span>}
          <span className="truncate">{title}</span>
          {badge}
        </span>
        <ChevronDown size={18} className="text-muted transition-transform group-open:rotate-180 shrink-0" />
      </summary>
      <div className="px-4 pb-4 md:px-5 md:pb-5 flex flex-col gap-4">{children}</div>
    </details>
  );
}
