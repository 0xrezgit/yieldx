'use client';

import { useState } from 'react';

const PALETTE = ['#7C5CFF', '#22D3EE', '#F59E0B', '#34D399', '#FB7185', '#38BDF8', '#A78BFA', '#F472B6'];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Token logo from a remote URL, falling back to a coloured monogram. */
export function TokenLogo({ src, name, size = 40 }: { src?: string | null; name: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const letters = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || '?';
  const color = PALETTE[hash(name) % PALETTE.length];

  if (src && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote logos from many hosts; no optimisation needed
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="rounded-full bg-elevated object-cover shrink-0 ring-1 ring-white/10"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <span
      aria-hidden
      className="grid place-items-center rounded-full shrink-0 font-bold text-white ring-1 ring-white/10"
      style={{ width: size, height: size, fontSize: size * 0.36, background: `linear-gradient(135deg, ${color}, ${color}99)` }}
      dir="ltr"
    >
      {letters}
    </span>
  );
}
