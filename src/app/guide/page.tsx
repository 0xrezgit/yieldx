import type { Metadata } from 'next';
import Link from 'next/link';
import { BookOpen, ChartCandlestick, HardDriveDownload, Radar, Wallet, Activity } from 'lucide-react';
import type { ReactNode } from 'react';

export const metadata: Metadata = { title: 'راهنما — YieldX' };

interface Task {
  id: string;
  icon: ReactNode;
  title: string;
  href: string;
  cta: string;
  steps: string[];
}

/** Organised by what the user is trying to do, not by screen. */
const tasks: Task[] = [
  {
    id: 'discover',
    icon: <Radar size={18} aria-hidden />,
    title: 'کشف فرصت',
    href: '/opportunities',
    cta: 'رفتن به فرصت‌ها',
    steps: [
      'استراتژی را انتخاب کنید: YT (پوینت)، PT (نرخ ثابت) یا Loop (اهرم).',
      'با فیلترها بازارها را محدود کنید: پروتکل، شبکه، نوع دارایی، بازه‌ی سررسید، حداقل نقدینگی و پوینت. جست‌وجو نماد، پروژه، شبکه و آدرس را پیدا می‌کند.',
      'روی سرستون‌ها بزنید تا مرتب شود؛ «جزئیات» هر ردیف لیمیت‌ها و هشدارها را نشان می‌دهد. نرخ بالا به‌تنهایی نشانه‌ی فرصت خوب نیست.',
      '«محاسبه» بازار را در ماشین‌حساب با همان فرض‌ها باز می‌کند.',
    ],
  },
  {
    id: 'analyze',
    icon: <ChartCandlestick size={18} aria-hidden />,
    title: 'تحلیل یک بازار',
    href: '/dashboard',
    cta: 'رفتن به تحلیل بازار',
    steps: [
      'پروتکل و بازار را انتخاب و سرمایه را وارد کنید. تا انتخاب بازار هیچ نتیجه‌ای نمایش داده نمی‌شود.',
      'عدد اصلی «نتیجه‌ی نقدی تخمینی» است و ارزش ایردراپ را شامل نمی‌شود؛ ایردراپ در «پوینت و فرض‌ها» با برچسب «فرضی» آمده است.',
      'کنار هویت بازار منبع داده و زمان دریافت را ببینید. «قدیمی» یعنی داده‌ی تازه دریافت نشده؛ «—» یعنی API آن عدد را نداده و صفر فرض نمی‌شود.',
      'با تعویض بازار، فرض‌های پوینت و ایردراپ بازار قبلی پاک می‌شوند مگر خودتان در «تنظیمات پیشرفته» نگه‌داشتن آن‌ها را انتخاب کنید.',
    ],
  },
  {
    id: 'record',
    icon: <Wallet size={18} aria-hidden />,
    title: 'ثبت پوزیشن',
    href: '/portfolio/new',
    cta: 'ثبت پوزیشن',
    steps: [
      'پلتفرم، شبکه، بازار و نوع (PT، YT یا Loop) را انتخاب کنید؛ انتخاب‌ها بالای صفحه قابل ویرایش‌اند.',
      'زمان و مقدار واقعی تراکنش را وارد کنید؛ قیمت امروز جایگزین قیمت خرید نمی‌شود.',
      'اگر با خود دارایی پایه پرداخت کرده‌اید یک نرخ کافی است؛ در غیر این صورت نرخ ارز پرداختی و نرخ دارایی پایه جدا وارد می‌شوند.',
      'کارمزدی که از مبلغ کم شده را «داخل مبلغ» علامت بزنید تا دو بار کم نشود.',
    ],
  },
  {
    id: 'track',
    icon: <Activity size={18} aria-hidden />,
    title: 'پیگیری',
    href: '/portfolio',
    cta: 'رفتن به پرتفوی',
    steps: [
      'ارزش خالص، سود و زیان، سرمایه‌ی واردشده و بدهی جدا نمایش داده می‌شوند.',
      'برچسب هر عدد نشان می‌دهد به‌روز، قدیمی، دستی یا تخمینی است.',
      'نمودار عملکرد فقط از نقاط ثبت‌شده‌ی واقعی ساخته می‌شود و جای خالی پر نمی‌شود.',
    ],
  },
  {
    id: 'backup',
    icon: <HardDriveDownload size={18} aria-hidden />,
    title: 'پشتیبان',
    href: '/portfolio',
    cta: 'پشتیبان در پرتفوی',
    steps: ['پوزیشن‌ها فقط در همین مرورگر ذخیره می‌شوند؛ حساب کاربری و کیف پول در کار نیست.', 'از «دریافت فایل پشتیبان» در بالای صفحه‌ی پرتفوی استفاده کنید و فایل را با «بازیابی از فایل» برگردانید.'],
  },
];

const terms: [string, string][] = [
  ['PT (توکن اصل)', 'در سررسید دقیقاً ۱ واحد دارایی پایه می‌شود؛ یعنی سود ثابت.'],
  ['YT (توکن بازده)', 'تا سررسید بازده دارایی را می‌گیرد و بعد صفر می‌شود؛ معمولاً پوینت هم دارد.'],
  ['نرخ بازار (Implied APY)', 'سودی که خریدار PT قفل می‌کند و خریدار YT می‌پردازد.'],
  ['بازده پایه (APY)', 'سودی که دارایی همین حالا می‌دهد. اگر از نرخ بازار کمتر باشد، YT گران است.'],
  ['دارایی پایه / واحد بازخرید', 'واحدی که PT در سررسید به آن تبدیل می‌شود و قیمت PT و YT بر حسب آن است. USD، USDC و USDT یکی نیستند.'],
  ['نتیجه‌ی نقدی', 'سود یا زیان دلاری با فرض ثابت ماندن نرخ‌ها، بدون ارزش ایردراپ.'],
  ['سناریوی فرضی ایردراپ', 'ارزش پوینت‌ها با FDV، سهم ایردراپ و کل پوینت‌هایی که خودتان فرض می‌کنید؛ تضمینی نیست.'],
  ['Loop (لوپ PT)', 'PT را وثیقه می‌گذارید، وام می‌گیرید و دوباره PT می‌خرید. بازده بیشتر، ریسک لیکوئید.'],
  ['Health Factor', 'نسبت آستانه‌ی لیکوئید به LTV فعلی. زیر ۱ یعنی لیکوئید.'],
  ['LLTV', 'آستانه‌ی لیکوئید بازار وام‌دهی.'],
  ['CLMM', 'نقدینگی در یک بازه‌ی نرخ (فقط در Exponent). بیرون از بازه، کارمزد و پوینت قطع می‌شود.'],
  ['لیمیت خرید YT', 'بالاترین نرخ Implied که اگر YT را در آن بخرید و با همان نرخ بفروشید، ضرر نقدی ندارید.'],
  ['اسنپ‌شات', 'روزی که پوینت‌ها برای ایردراپ شمرده می‌شوند.'],
  ['کیفیت داده', '«به‌روز» دریافت اخیر از API، «قدیمی» داده‌ی کهنه یا قطع API، «دستی» عدد واردشده‌ی شما، «تخمینی» مدل‌سازی‌شده، «—» ناموجود.'],
];

export default function GuidePage() {
  return (
    <main className="sx max-w-3xl mx-auto px-[var(--space-page-x)] py-6 flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="page-title">راهنما</h1>
        <p className="text-sm text-secondary">بر اساس کاری که می‌خواهید انجام دهید.</p>
      </header>

      <nav aria-label="بخش‌های راهنما" className="flex flex-wrap gap-2">
        {tasks.map((t) => (
          <a key={t.id} href={`#${t.id}`} className="tap inline-flex items-center gap-1.5 rounded-full border border-default px-3 min-h-9 text-sm text-secondary hover:text-primary">
            {t.icon} {t.title}
          </a>
        ))}
        <a href="#terms" className="tap inline-flex items-center gap-1.5 rounded-full border border-default px-3 min-h-9 text-sm text-secondary hover:text-primary">
          <BookOpen size={16} aria-hidden /> اصطلاحات
        </a>
      </nav>

      {tasks.map((t) => (
        <section key={t.id} id={t.id} className="sx-card p-5 flex flex-col gap-3 scroll-mt-20" aria-labelledby={`${t.id}-h`}>
          <h2 id={`${t.id}-h`} className="text-lg font-semibold text-primary flex items-center gap-2">
            <span className="text-accent">{t.icon}</span> {t.title}
          </h2>
          <ol className="flex flex-col gap-2 list-decimal pr-5 text-[15px] text-secondary leading-7 marker:text-muted">
            {t.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
          <Link href={t.href} className="tap self-start text-accent underline underline-offset-4 text-sm">
            {t.cta}
          </Link>
        </section>
      ))}

      <section id="terms" className="sx-card p-5 scroll-mt-20" aria-labelledby="terms-h">
        <h2 id="terms-h" className="text-lg font-semibold text-primary mb-3">
          اصطلاحات
        </h2>
        <dl className="flex flex-col divide-y divide-default">
          {terms.map(([t, d]) => (
            <div key={t} className="py-3 first:pt-0 last:pb-0">
              <dt className="font-semibold text-primary">{t}</dt>
              <dd className="text-secondary text-sm leading-7">{d}</dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="text-sm text-muted text-center">اعداد تخمینی‌اند و توصیه‌ی مالی نیستند. کنار ورودی‌ها هم دکمه‌ی (؟) توضیح همان اصطلاح را باز می‌کند.</p>
    </main>
  );
}
