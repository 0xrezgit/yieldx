'use client';

import Link from 'next/link';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, BookOpen, Calculator, Coins, Droplets, Gift, Landmark, Layers, LogOut, Lock, Repeat, Shapes, Sigma, Sparkles, Target, Vault } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { LESSONS } from '../../lib/learn/lessons';

type Lesson = (typeof LESSONS)[number];

const ICON: Record<string, LucideIcon> = {
  lending: Landmark,
  vault: Vault,
  lp: Droplets,
  'pool-types': Shapes,
  rewards: Sparkles,
  pt: Lock,
  yt: Gift,
  loop: Repeat,
};

function Part({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-[15px] font-semibold text-primary flex items-center gap-2">
        <span className="text-accent shrink-0">{icon}</span> {title}
      </h3>
      {children}
    </div>
  );
}

const Bullets = ({ items }: { items: string[] }) => (
  <ul className="flex flex-col gap-1.5 list-disc pr-5 text-[15px] text-secondary leading-7 marker:text-muted">
    {items.map((s) => (
      <li key={s}>{s}</li>
    ))}
  </ul>
);

/** One lesson: the idea first (where the money comes from, the formula, an example), then how to act on it. */
function LessonBody({ l }: { l: Lesson }) {
  const Icon = ICON[l.id] ?? Layers;
  return (
    <article id={l.id} className="sx-card p-5 sm:p-7 flex flex-col gap-6 scroll-mt-24" aria-labelledby={`${l.id}-h`}>
      <header className="flex items-start gap-3">
        <span className="choice-icon shrink-0 !size-11 !rounded-xl !text-on-brand !bg-brand !border-brand">
          <Icon size={20} aria-hidden />
        </span>
        <div className="flex flex-col gap-1 min-w-0">
          <h2 id={`${l.id}-h`} className="text-xl font-semibold text-primary flex flex-wrap items-baseline gap-x-2">
            {l.title}
            <bdi dir="ltr" className="latin text-sm font-normal text-accent">
              {l.en}
            </bdi>
          </h2>
          <p className="text-[15px] text-secondary leading-7">{l.short}</p>
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Part icon={<Coins size={17} aria-hidden />} title="سود از کجا می‌آید">
          <Bullets items={l.source} />
        </Part>
        <Part icon={<Sigma size={17} aria-hidden />} title="فرمول">
          <div dir="ltr" className="latin rounded-lg border border-default bg-canvas px-4 py-3 flex flex-col gap-1.5 text-sm text-primary overflow-x-auto">
            {l.formula.map((f) => (
              <code key={f} className="whitespace-pre">
                {f}
              </code>
            ))}
          </div>
          {l.terms && <p className="text-sm text-muted leading-6">{l.terms.join(' · ')}</p>}
        </Part>
      </div>

      <Part icon={<Calculator size={17} aria-hidden />} title="مثال عددی">
        <ol className="flex flex-col gap-1.5 list-decimal pr-5 text-[15px] text-secondary leading-7 marker:text-muted rounded-lg bg-canvas border border-default py-3 pl-4">
          {l.example.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </Part>

      <Part icon={<Sparkles size={17} aria-hidden />} title="YieldX چطور حساب می‌کند">
        <Bullets items={l.yieldx} />
      </Part>

      {l.skills.length > 0 && (
        <Part icon={<Target size={17} aria-hidden />} title="قبل از ورود، خودتان چک کنید">
          <ol className="flex flex-col gap-1.5 list-decimal pr-5 text-[15px] text-secondary leading-7 marker:text-accent">
            {l.skills.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </Part>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Part icon={<AlertTriangle size={17} aria-hidden />} title="خطرها">
          <Bullets items={l.risks} />
        </Part>
        <Part icon={<LogOut size={17} aria-hidden />} title="خروج">
          <p className="text-[15px] text-secondary leading-7">{l.exit}</p>
        </Part>
      </div>

      {l.vocab.length > 0 && (
        <details className="group rounded-lg border border-default">
          <summary className="tap flex items-center justify-between gap-2 px-4 min-h-11 text-[15px] font-semibold text-primary">
            <span className="flex items-center gap-2">
              <BookOpen size={17} aria-hidden className="text-accent" /> اصطلاحات انگلیسی ({l.vocab.length.toLocaleString('fa-IR')})
            </span>
            <span className="text-xs text-muted group-open:hidden">نمایش</span>
          </summary>
          <dl className="flex flex-col divide-y divide-default px-4 pb-3">
            {l.vocab.map((v) => (
              <div key={v.en} className="py-2.5 flex flex-col gap-0.5">
                <dt className="flex flex-wrap items-baseline gap-x-2">
                  <bdi dir="ltr" className="latin text-sm font-semibold text-accent">
                    {v.en}
                  </bdi>
                  <span className="text-sm text-primary">{v.fa}</span>
                </dt>
                <dd className="text-sm text-secondary leading-6">{v.means}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      {l.link && (
        <Link href={l.link.href} className="tap self-start inline-flex items-center gap-1.5 rounded-md border border-strong px-4 min-h-10 text-sm font-medium text-primary hover:bg-hover">
          {l.link.label} <ArrowLeft size={15} aria-hidden />
        </Link>
      )}
    </article>
  );
}

/**
 * The lessons as a grid of cards; only the chosen one is open under it. `#<lesson id>`
 * in the address (links from other pages, the comparison table) opens that lesson.
 */
export function LessonBrowser() {
  const [id, setId] = useState<string>(LESSONS[0].id);
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pick = () => {
      const h = decodeURIComponent(window.location.hash.slice(1));
      if (LESSONS.some((l) => l.id === h)) {
        setId(h);
        requestAnimationFrame(() => body.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      }
    };
    pick();
    window.addEventListener('hashchange', pick);
    return () => window.removeEventListener('hashchange', pick);
  }, []);
  const lesson = LESSONS.find((l) => l.id === id) ?? LESSONS[0];
  const choose = (next: string) => {
    setId(next);
    history.replaceState(null, '', `#${next}`);
    requestAnimationFrame(() => body.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };
  return (
    <>
      <div role="tablist" aria-label="درس‌ها" className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        {LESSONS.map((l) => {
          const Icon = ICON[l.id] ?? Layers;
          return (
            <button key={l.id} type="button" role="tab" aria-selected={l.id === id} aria-controls="lesson" onClick={() => choose(l.id)} className="choice">
              <span className="choice-icon">
                <Icon size={16} aria-hidden />
              </span>
              <span className="font-semibold text-primary text-[15px] leading-snug">{l.title}</span>
              <span className="text-xs text-muted leading-relaxed line-clamp-2">{l.short}</span>
            </button>
          );
        })}
      </div>
      <div ref={body} id="lesson" role="tabpanel" className="scroll-mt-24">
        <LessonBody key={lesson.id} l={lesson} />
      </div>
    </>
  );
}
