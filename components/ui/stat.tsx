'use client';

interface StatProps {
  label: string;
  value: string;
  /** Tailwind text color class, defaults to text-primary. */
  color?: string;
}

/** KPI display — headline data always JetBrains Mono + tabular-nums. */
export function Stat({ label, value, color = 'text-primary' }: StatProps) {
  return (
    <div className="flex flex-col gap-2 min-w-0">
      <div className="text-[10px] uppercase tracking-widest text-secondary font-medium truncate">
        {label}
      </div>
      <div
        className={`text-2xl md:text-3xl font-semibold font-mono tabular-nums leading-none break-words ${color}`}
      >
        {value}
      </div>
    </div>
  );
}
