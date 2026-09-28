import { expect } from 'vitest';

/** Visible text writes dollars as «دلار» and digits in Persian (symbols like USDe stay Latin). */
export function assertPersianMoney(html: string) {
  const text = html.replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, ' ');
  expect(/.{0,40}\$.{0,40}/.exec(text)?.[0] ?? null).toBeNull();
  expect(/.{0,40}[0-9].{0,40}/.exec(text)?.[0] ?? null).toBeNull();
}
