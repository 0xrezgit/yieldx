import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'راهنما — YieldX' };

const steps = [
  'پروتکل را انتخاب کنید و از فهرست زنده (با لوگو، نرخ، نقدینگی و پوینت) بازار را برگزینید؛ داده‌ها خودکار پر می‌شوند.',
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
  ['برنامه‌ی خروج', 'تا کِی YT را نگه دارید تا بیشترین پوینت را با ضرری کمتر از سقف خودتان بگیرید، و در چه قیمتی زودتر بی‌ضرر بفروشید.'],
  ['فرصت‌ها', 'بهترین بازارها برای YT (پوینت)، PT ثابت و لوپ PT از همه‌ی پروتکل‌ها، با لیمیت خرید پیشنهادی و ماشین‌حساب سناریو.'],
  ['لیمیت خرید YT', 'بالاترین نرخ Implied که اگر YT را در آن بخرید و با همان نرخ بفروشید، ضرر نمی‌کنید (سبز) یا ضررتان از سقف بیشتر نمی‌شود (زرد).'],
  ['اسنپ‌شات', 'روزی که پوینت‌ها برای ایردراپ شمرده می‌شوند. بعد از آن نگه داشتن YT برای پوینت فایده ندارد.'],
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
