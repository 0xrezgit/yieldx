import { ImageResponse } from 'next/og';

/**
 * App icon: violet→cyan square with a rising yield line. Artwork stays inside the
 * central 60% so the same image works as a maskable icon.
 */
export function renderAppIcon(size: number) {
  const stroke = Math.round(size * 0.075);
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #7C5CFF 0%, #22D3EE 100%)',
        }}
      >
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 100 100" fill="none">
          <polyline
            points="10,78 36,54 56,66 86,28"
            stroke="white"
            strokeWidth={(stroke / (size * 0.6)) * 100}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <circle cx="86" cy="28" r="9" fill="white" />
        </svg>
      </div>
    ),
    { width: size, height: size },
  );
}
