'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import type { TermGroup } from '../../lib/learn/content';

/** The glossary, filtered as you type (Persian or English). */
export function Glossary({ groups }: { groups: TermGroup[] }) {
  const [q, setQ] = useState('');
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return groups;
    return groups
      .map((g) => ({ ...g, terms: g.terms.filter((t) => `${t.fa} ${t.en} ${t.means}`.toLowerCase().includes(k)) }))
      .filter((g) => g.terms.length > 0);
  }, [groups, q]);

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-center gap-2 rounded-lg border border-default bg-surface px-3 min-h-11 focus-within:border-strong">
        <Search size={16} aria-hidden className="text-muted shrink-0" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="جستجوی اصطلاح (فارسی یا انگلیسی)" className="flex-1 min-w-0 bg-transparent outline-none text-sm text-primary placeholder:text-muted" aria-label="جستجوی اصطلاح" />
      </label>
      {shown.length === 0 && <p className="text-sm text-muted">اصطلاحی پیدا نشد.</p>}
      {shown.map((g) => (
        <div key={g.id} className="flex flex-col gap-2">
          <h3 className="text-[15px] font-semibold text-primary">{g.title}</h3>
          {!q && <p className="text-sm text-muted leading-6">{g.intro}</p>}
          <dl className="flex flex-col divide-y divide-default">
            {g.terms.map((t) => (
              <div key={t.id} id={`term-${t.id}`} className="py-3 first:pt-1 last:pb-0 flex flex-col gap-1 scroll-mt-20">
                <dt className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-semibold text-primary">{t.fa}</span>
                  <bdi dir="ltr" className="latin text-sm text-accent">
                    {t.en}
                  </bdi>
                </dt>
                <dd className="text-sm text-secondary leading-7">{t.means}</dd>
                <dd className="text-sm text-muted leading-7">مثل: {t.like}</dd>
                {t.where && (
                  <dd>
                    <Link href={t.where.href} className="tap text-xs text-accent underline underline-offset-4">
                      {t.where.label}
                    </Link>
                  </dd>
                )}
              </div>
            ))}
          </dl>
        </div>
      ))}
    </div>
  );
}
