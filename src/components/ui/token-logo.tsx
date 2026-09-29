'use client';

import { useState } from 'react';

/** Muted hues for monograms: readable white text (≥ 4.5:1), never a brand's colour. */
const PALETTE = ['#4C5A73', '#4F5B8A', '#5A4F84', '#4E6B6B', '#6B5A4E', '#5E6A4C', '#6A4E62', '#4E5F7A'];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const letters = (name: string) => name.replace(/^(PT|YT)[-\s]/i, '').replace(/[^A-Za-z0-9؀-ۿ]/g, '').slice(0, 2).toUpperCase() || '?';

/**
 * A logo at a fixed size (no layout shift), loaded lazily. When there is no URL or
 * the image fails, a monogram of the name is shown instead — never an empty circle
 * or a broken image. Brand colours are kept (no filters); `alt` is empty because the
 * name is always written next to the logo.
 */
export function TokenLogo({ src, name, size = 40, square = false }: { src?: string | null; name: string; size?: number; square?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  const radius = square ? 'rounded-md' : 'rounded-full';
  const box = { width: size, height: size, minWidth: size };

  if (src && failed !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote and local logos, fixed size; no optimisation needed
      <img
        key={src}
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(src)}
        className={`${radius} bg-elevated object-cover shrink-0`}
        style={box}
      />
    );
  }
  return (
    <span
      aria-hidden
      className={`grid place-items-center ${radius} shrink-0 font-semibold text-white leading-none select-none`}
      style={{ ...box, fontSize: Math.max(8, Math.round(size * 0.38)), background: PALETTE[hash(name) % PALETTE.length] }}
      dir="ltr"
    >
      {letters(name)}
    </span>
  );
}
