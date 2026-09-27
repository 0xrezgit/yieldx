import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'راهنما — YieldX' };

const steps = [
  'پروتکل و بازار را انتخاب کنید؛ داده‌ها خودکار پر می‌شوند.',
  'سرمایه و فرض‌های ایردراپ را وارد کنید.',
  'در «نتیجه» پیشنهاد و هشدارها را ببینید.',
];

const terms: [string, string][] = [
  ['PT', 'توکن اصل. در سررسید دقیقاً ۱ واحد دارایی می‌شود؛ یعنی سود ثابت.'],
  ['YT', 'توکن بازده. تا سررسید بازده دارایی را می‌گیرد و بعد صفر می‌شود؛ معمولاً پوینت هم دارد.'],
  ['نرخ بازار (Implied)', 'سودی که خریدار PT قفل می‌کند و خریدار YT می‌پردازد.'],
  ['بازده فعلی (APY)', 'سودی که دارایی همین حالا می‌دهد. اگر از نرخ بازار کمتر باشد، YT گران است.'],
  ['هزینه‌ی ۱M پوینت', 'پولی که با خرید YT برای هر یک میلیون پوینت از دست می‌دهید.'],
  ['FDV سربه‌سر', 'ارزش توکن که در آن ایردراپ هزینه‌ی شما را جبران می‌کند.'],
  ['لوپ', 'PT را وثیقه می‌گذارید، وام می‌گیرید و دوباره PT می‌خرید. سود بیشتر، ریسک لیکوئید.'],
  ['CLMM', 'نقدینگی در یک بازه‌ی نرخ. بیرون از بازه، کارمزد و پوینت قطع می‌شود.'],
];

export default function GuidePage() {
  return (
    <main className="max-w-2xl mx-auto px-4 lg:px-6 py-5 flex flex-col gap-4">
      <h1 className="text-2xl font-extrabold text-primary">راهنما</h1>

      <section className="bg-surface/80 border border-default rounded-2xl p-5">
        <ol className="flex flex-col gap-3">
          {steps.map((s, i) => (
            <li key={s} className="flex items-center gap-3">
              <span className="grid place-items-center size-8 rounded-full brand-gradient text-white font-bold shrink-0 num">
                {(i + 1).toLocaleString('fa-IR')}
              </span>
              <span className="text-primary">{s}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="bg-surface/80 border border-default rounded-2xl p-5">
        <dl className="flex flex-col divide-y divide-default">
          {terms.map(([t, d]) => (
            <div key={t} className="py-3 first:pt-0 last:pb-0">
              <dt className="font-bold text-primary">{t}</dt>
              <dd className="text-secondary text-sm">{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="text-xs text-muted text-center">اعداد تخمینی‌اند و توصیه‌ی مالی نیستند.</p>
    </main>
  );
}
