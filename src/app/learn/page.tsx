import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, BookOpen, Footprints, ShieldCheck, Table2 } from 'lucide-react';
import { Glossary } from '../../components/learn/Glossary';
import { GLOSSARY, SAFETY, WALKTHROUGHS } from '../../lib/learn/content';
import { COMPARE } from '../../lib/learn/lessons';
import { LessonBrowser } from '../../components/learn/LessonBrowser';

export const metadata: Metadata = { title: 'آموزش — YieldX' };

const chip = 'tap inline-flex items-center gap-1.5 rounded-full border border-default px-3 min-h-9 text-sm text-secondary hover:text-primary';

const Bullets = ({ items }: { items: string[] }) => (
  <ul className="flex flex-col gap-1.5 list-disc pr-5 text-[15px] text-secondary leading-7 marker:text-muted">
    {items.map((s) => (
      <li key={s}>{s}</li>
    ))}
  </ul>
);

export default function LearnPage() {
  return (
    <main className="sx max-w-5xl mx-auto px-[var(--space-page-x)] py-6 lg:py-8 flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="page-title">آموزش</h1>
        <p className="page-sub max-w-2xl">
          یک روش را انتخاب کنید: پول از کجا می‌آید، فرمول و یک مثال عددی، YieldX چطور سود خالص دلاری را می‌سازد و قبل از ورود چه چیزی را خودتان چک کنید.
        </p>
      </header>

      <nav aria-label="بخش‌های دیگر" className="flex flex-wrap gap-2">
        <a href="#compare" className={chip}>
          <Table2 size={15} aria-hidden /> مقایسه در یک نگاه
        </a>
        <a href="#walkthroughs" className={chip}>
          <Footprints size={15} aria-hidden /> قدم‌به‌قدم با YieldX
        </a>
        <a href="#glossary" className={chip}>
          <BookOpen size={15} aria-hidden /> واژه‌نامه
        </a>
      </nav>

      <LessonBrowser />

      <section id="compare" className="sx-card p-5 sm:p-6 flex flex-col gap-3 scroll-mt-20" aria-labelledby="compare-h">
        <h2 id="compare-h" className="text-lg font-semibold text-primary flex items-center gap-2">
          <Table2 size={18} aria-hidden className="text-accent" /> مقایسه در یک نگاه
        </h2>
        <div className="overflow-x-auto -mx-1">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="text-muted text-right border-b border-default">
                <th className="py-2 px-1 font-medium">روش</th>
                <th className="py-2 px-1 font-medium">سود از</th>
                <th className="py-2 px-1 font-medium">نرخ</th>
                <th className="py-2 px-1 font-medium">خطر اصلی</th>
                <th className="py-2 px-1 font-medium">خروج</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-default">
              {COMPARE.map((c) => (
                <tr key={c.id} className="text-secondary align-top">
                  <th scope="row" className="py-2.5 px-1 text-right font-semibold text-primary">
                    <a href={`#${c.id}`} className="hover:text-accent">
                      {c.name}
                    </a>
                  </th>
                  <td className="py-2.5 px-1 leading-6">{c.source}</td>
                  <td className="py-2.5 px-1 leading-6">{c.rate}</td>
                  <td className="py-2.5 px-1 leading-6">{c.risk}</td>
                  <td className="py-2.5 px-1 leading-6">{c.exit}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section id="walkthroughs" className="flex flex-col gap-4 scroll-mt-20" aria-labelledby="walk-h">
        <h2 id="walk-h" className="text-lg font-semibold text-primary flex items-center gap-2">
          <Footprints size={18} aria-hidden className="text-accent" /> قدم‌به‌قدم با YieldX
        </h2>
        {WALKTHROUGHS.map((w) => (
          <details key={w.id} id={`walk-${w.id}`} className="group sx-card scroll-mt-20">
            <summary className="tap flex items-center justify-between gap-3 px-5 min-h-13 text-[15px] font-semibold text-primary">
              {w.title}
              <span className="text-xs font-normal text-muted">{w.steps.length.toLocaleString('fa-IR')} قدم</span>
            </summary>
            <div className="px-5 pb-5 flex flex-col gap-3">
              <p className="text-sm text-muted leading-6">{w.before}</p>
              <ol className="flex flex-col gap-3">
                {w.steps.map((s, i) => (
                  <li key={s.title} className="flex gap-3">
                    <span className="num shrink-0 grid place-items-center size-7 rounded-full bg-accent/15 text-accent text-sm font-semibold">{(i + 1).toLocaleString('fa-IR')}</span>
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="font-semibold text-primary">{s.title}</span>
                      <span className="text-sm text-secondary leading-7">{s.body}</span>
                      {s.warn && (
                        <span className="text-sm text-warning leading-6 flex gap-1.5">
                          <AlertTriangle size={15} aria-hidden className="shrink-0 mt-1" /> {s.warn}
                        </span>
                      )}
                      {s.link && (
                        <Link href={s.link.href} className="tap self-start text-xs text-accent underline underline-offset-4">
                          {s.link.label}
                        </Link>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </details>
        ))}
      </section>

      <section id="glossary" className="sx-card p-5 flex flex-col gap-3 scroll-mt-20" aria-labelledby="glossary-h">
        <h2 id="glossary-h" className="text-lg font-semibold text-primary flex items-center gap-2">
          <BookOpen size={18} aria-hidden className="text-accent" /> واژه‌نامه
        </h2>
        <Glossary groups={GLOSSARY} />
      </section>

      <section className="sx-card p-5 flex flex-col gap-3" aria-labelledby="safety-h">
        <h2 id="safety-h" className="text-lg font-semibold text-primary flex items-center gap-2">
          <ShieldCheck size={18} aria-hidden className="text-accent" /> ایمنی
        </h2>
        <Bullets items={SAFETY} />
      </section>

      <p className="text-sm text-muted text-center">
        راهنمای کار با صفحه‌های اپ در{' '}
        <Link href="/guide" className="text-accent underline underline-offset-4">
          راهنما
        </Link>
        ست. اعداد مثال‌ها نمونه‌اند و توصیه‌ی مالی نیستند.
      </p>
    </main>
  );
}
