import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle, BookOpen, Calculator, Coins, Footprints, GraduationCap, LogOut, ShieldCheck, Sigma, Sparkles, Table2, Target } from 'lucide-react';
import type { ReactNode } from 'react';
import { Glossary } from '../../components/learn/Glossary';
import { GLOSSARY, SAFETY, WALKTHROUGHS } from '../../lib/learn/content';
import { COMPARE, LESSONS } from '../../lib/learn/lessons';

export const metadata: Metadata = { title: 'آموزش — YieldX' };

const chip = 'tap inline-flex items-center gap-1.5 rounded-full border border-default px-3 min-h-9 text-sm text-secondary hover:text-primary';

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

export default function LearnPage() {
  return (
    <main className="sx max-w-3xl mx-auto px-[var(--space-page-x)] py-6 flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="page-title flex items-center gap-2">
          <GraduationCap size={24} aria-hidden className="text-accent" /> آموزش
        </h1>
        <p className="text-[15px] text-secondary leading-7">
          هر روش سود: پول از کجا می‌آید، با چه فرمولی حساب می‌شود، یک مثال عددی، YieldX چطور سود خالص دلاری را می‌سازد، چه چیزی را خودتان قبل از ورود چک کنید و اصطلاحات انگلیسی‌ای که در سایت پروتکل‌ها می‌بینید.
        </p>
      </header>

      <nav aria-label="درس‌ها" className="flex flex-wrap gap-2">
        {LESSONS.map((l) => (
          <a key={l.id} href={`#${l.id}`} className={chip}>
            {l.title}
          </a>
        ))}
        <a href="#compare" className={chip}>
          <Table2 size={15} aria-hidden /> مقایسه
        </a>
        <a href="#walkthroughs" className={chip}>
          <Footprints size={15} aria-hidden /> قدم‌به‌قدم
        </a>
        <a href="#glossary" className={chip}>
          <BookOpen size={15} aria-hidden /> واژه‌نامه
        </a>
      </nav>

      {LESSONS.map((l) => (
        <section key={l.id} id={l.id} className="sx-card p-5 flex flex-col gap-5 scroll-mt-20" aria-labelledby={`${l.id}-h`}>
          <header className="flex flex-col gap-1">
            <h2 id={`${l.id}-h`} className="text-lg font-semibold text-primary flex flex-wrap items-baseline gap-x-2">
              {l.title}
              <bdi dir="ltr" className="latin text-sm font-normal text-accent">
                {l.en}
              </bdi>
            </h2>
            <p className="text-[15px] text-secondary leading-7">{l.short}</p>
          </header>

          <Part icon={<Coins size={17} aria-hidden />} title="سود از کجا می‌آید">
            <Bullets items={l.source} />
          </Part>

          <Part icon={<Sigma size={17} aria-hidden />} title="فرمول">
            <div dir="ltr" className="latin rounded-lg border border-default bg-surface px-4 py-3 flex flex-col gap-1.5 text-sm text-primary overflow-x-auto">
              {l.formula.map((f) => (
                <code key={f} className="whitespace-pre">
                  {f}
                </code>
              ))}
            </div>
            {l.terms && <p className="text-sm text-muted leading-6">{l.terms.join(' · ')}</p>}
          </Part>

          <Part icon={<Calculator size={17} aria-hidden />} title="مثال عددی">
            <ol className="flex flex-col gap-1.5 list-decimal pr-5 text-[15px] text-secondary leading-7 marker:text-muted">
              {l.example.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
          </Part>

          <Part icon={<Sparkles size={17} aria-hidden />} title="YieldX چطور حساب می‌کند">
            <Bullets items={l.yieldx} />
          </Part>

          {l.skills.length > 0 && (
            <Part icon={<Target size={17} aria-hidden />} title="مهارت عملی: قبل از ورود خودتان چک کنید">
              <ol className="flex flex-col gap-1.5 list-decimal pr-5 text-[15px] text-secondary leading-7 marker:text-accent">
                {l.skills.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </Part>
          )}

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

          <Part icon={<AlertTriangle size={17} aria-hidden />} title="خطرها">
            <Bullets items={l.risks} />
          </Part>

          <Part icon={<LogOut size={17} aria-hidden />} title="خروج">
            <p className="text-[15px] text-secondary leading-7">{l.exit}</p>
          </Part>

          {l.link && (
            <Link href={l.link.href} className="tap self-start text-accent underline underline-offset-4 text-sm">
              {l.link.label}
            </Link>
          )}
        </section>
      ))}

      <section id="compare" className="sx-card p-5 flex flex-col gap-3 scroll-mt-20" aria-labelledby="compare-h">
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
