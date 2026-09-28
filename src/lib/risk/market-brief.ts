import protocols from '../../config/protocols.json';
import type { Analysis } from '../analysis';
import type { ScenarioParams } from '../../types/scenario';
import { formatDate, formatMultiplier, formatNumber, formatPercent, formatUSDCompact } from '../utils/formatting';

export type BriefTone = 'neutral' | 'good' | 'warn' | 'bad';

export interface BriefLine {
  label: string;
  text: string;
  tone: BriefTone;
}

/** A short, plain-Persian description of the selected market. */
export function buildMarketBrief(p: ScenarioParams, a: Analysis): BriefLine[] {
  const lines: BriefLine[] = [];
  const protocol = protocols[p.protocol]?.name ?? p.protocol;
  const name = p.marketName || 'این بازار';
  const project = p.platform || 'پروژه';

  lines.push({
    label: 'بازار',
    text: `${name} روی ${protocol}${p.platform ? ` (${p.platform})` : ''}؛ سررسید ${formatDate(p.maturity)}، ${formatNumber(a.days, 0)} روز دیگر.`,
    tone: 'neutral',
  });

  const status = a.implied.status;
  lines.push({
    label: 'نرخ‌ها',
    text:
      `بازده فعلی ${formatPercent(p.baseAPY)}، نرخ بازار ${formatPercent(a.implied.impliedAPY)}. ` +
      (status === 'safe' ? 'YT ارزان است' : status === 'warning' ? 'YT کمی گران است' : 'YT گران است') +
      `؛ PT سود ثابت ${formatPercent(a.implied.impliedAPY)} قفل می‌کند.`,
    tone: status === 'safe' ? 'good' : status === 'warning' ? 'warn' : 'bad',
  });

  if (p.pointsStatus === 'active' && p.pointsPerDay > 0) {
    const basis = p.pointsBasis === 'usd' ? 'هر ۱ دلار' : 'هر واحد دارایی';
    const season = p.pointsSeason !== null ? `، فصل ${formatNumber(p.pointsSeason, 0)}` : '';
    lines.push({
      label: 'پوینت',
      text: `برنامه‌ی «${p.pointsName}» فعال است${season}: ${formatNumber(p.pointsPerDay, 4)} پوینت روزانه به ازای ${basis}، ضریب YT ${formatMultiplier(p.ytMultiplier, 0)} و LP ${formatMultiplier(p.lpMultiplier, 0)}.`,
      tone: 'good',
    });
  } else if (p.pointsStatus === 'active') {
    lines.push({
      label: 'پوینت',
      text: `این بازار برچسب پوینت دارد، ولی نرخ و ضریب در API نیست؛ آن‌ها را از سایت ${project} وارد کنید.`,
      tone: 'warn',
    });
  } else if (p.pointsStatus === 'none') {
    lines.push({
      label: 'پوینت',
      text: 'برنامه‌ی پوینت ثبت‌شده‌ای ندارد؛ از خرید YT فقط بازده می‌گیرید، نه ایردراپ.',
      tone: 'bad',
    });
  } else {
    lines.push({ label: 'پوینت', text: 'وضعیت پوینت نامشخص است؛ از سایت پروژه چک کنید.', tone: 'warn' });
  }

  if (p.pointsStatus !== 'none') {
    lines.push({
      label: 'ایردراپ',
      text: p.snapshotDate
        ? `اسنپ‌شات ${formatDate(p.snapshotDate)}. پوینت تضمین ایردراپ نیست؛ توکن و سهم ایردراپ را از اطلاعیه‌ی رسمی ${project} چک کنید.`
        : `تاریخ اسنپ‌شات مشخص نیست. پوینت تضمین ایردراپ نیست؛ اطلاعیه‌ی رسمی ${project} را چک کنید.`,
      tone: p.snapshotDate ? 'neutral' : 'warn',
    });
  }

  if (p.liquidity !== null) {
    lines.push({
      label: 'نقدینگی',
      text: `${formatUSDCompact(p.liquidity)}${a.liquidity.thin ? ' — کم است؛ خروج زودهنگام ممکن است گران تمام شود.' : '.'}`,
      tone: a.liquidity.thin ? 'warn' : 'neutral',
    });
  }

  return lines;
}
