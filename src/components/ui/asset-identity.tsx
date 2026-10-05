'use client';

import type { ProtocolId } from '../../types/protocol';
import { networkByName } from '../../lib/registry/networks';
import { protocolIdentity } from '../../lib/registry/identity';
import { formatDate, formatGregorian } from '../../lib/utils/formatting';
import { TokenLogo } from './token-logo';

export type IdentitySize = 24 | 32 | 48;

const BADGE: Record<IdentitySize, number> = { 24: 12, 32: 14, 48: 18 };
const TEXT: Record<IdentitySize, { name: string; sub: string }> = {
  24: { name: 'text-sm', sub: 'text-xs' },
  32: { name: 'text-[15px]', sub: 'text-xs' },
  48: { name: 'text-lg', sub: 'text-sm' },
};

/** Token logo with a small network badge on its corner (outside the logo's main area). */
export function LogoWithNetwork({ icon, name, chain, size }: { icon?: string | null; name: string; chain: string; size: IdentitySize }) {
  const net = networkByName(chain);
  const b = BADGE[size];
  return (
    <span className="relative shrink-0" style={{ width: size, height: size }}>
      <TokenLogo src={icon} name={name} size={size} />
      {chain && (
        <span className="absolute rounded-full ring-2 ring-surface bg-surface" style={{ insetInlineStart: -Math.round(b / 3), bottom: -Math.round(b / 3), width: b, height: b }} title={net.nameFa}>
          <TokenLogo src={net.logo} name={net.name} size={b} />
        </span>
      )}
    </span>
  );
}

/** Two token logos, overlapping, with the network badge on the front one (LP pairs). */
export function PairLogo({ a, b, chain, size }: { a: { symbol: string; logo?: string | null }; b: { symbol: string; logo?: string | null }; chain: string; size: IdentitySize }) {
  const back = Math.round(size * 0.8);
  return (
    <span className="relative shrink-0" style={{ width: size + Math.round(back * 0.7), height: size }}>
      <span className="absolute top-0 rounded-full ring-2 ring-surface" style={{ insetInlineEnd: 0 }}>
        <TokenLogo src={b.logo} name={b.symbol} size={back} />
      </span>
      <span className="absolute bottom-0" style={{ insetInlineStart: 0 }}>
        <LogoWithNetwork icon={a.logo} name={a.symbol} chain={chain} size={size} />
      </span>
    </span>
  );
}

interface Props {
  /** Official symbol (Latin, shown as is). */
  symbol: string;
  icon?: string | null;
  chain: string;
  protocol?: ProtocolId | null;
  /** Issuer / project of the asset (e.g. Ethena). */
  platform?: string | null;
  /** ISO maturity; shown on the second line to tell markets with the same symbol apart. */
  maturity?: string | null;
  /** PT / YT badge next to the symbol: the logo is the underlying asset's. */
  kind?: 'PT' | 'YT' | 'PT Loop' | null;
  size?: IdentitySize;
  /** Hide the second line (protocol · network · maturity). */
  compact?: boolean;
  className?: string;
}

/**
 * Who is who in one line pair: the token (logo + official symbol), its network
 * (badge + Persian name), the trading protocol and the maturity. Protocol, project,
 * network and token are four different things and are never merged into one label.
 */
export function AssetIdentity({ symbol, icon, chain, protocol, platform, maturity, kind, size = 32, compact = false, className = '' }: Props) {
  const net = networkByName(chain);
  const proto = protocol ? protocolIdentity(protocol) : null;
  const t = TEXT[size];
  const full = [kind ? `${kind} ${symbol}` : symbol, proto?.name, platform, net.name, maturity ? formatGregorian(maturity) : null].filter(Boolean).join(' · ');

  return (
    <span className={`flex items-center gap-2.5 min-w-0 ${className}`} title={full}>
      <LogoWithNetwork icon={icon} name={symbol} chain={chain} size={size} />
      <span className="min-w-0 flex flex-col leading-tight">
        <span className={`flex items-center gap-1.5 min-w-0 ${t.name} font-semibold text-primary`}>
          {kind && (
            <span className="shrink-0 rounded px-1 text-xs font-semibold bg-accent/15 text-accent" dir="ltr" aria-label={kind === 'YT' ? 'توکن بازده (YT)' : 'توکن اصل (PT)'}>
              {kind}
            </span>
          )}
          <bdi dir="ltr" className="truncate" data-technical="symbol">
            {symbol}
          </bdi>
        </span>
        {!compact && (
          <span className={`${t.sub} text-secondary truncate mt-0.5`}>
            {[proto?.name && <bdi key="p" dir="ltr">{proto.name}</bdi>, net.nameFa, maturity && `سررسید ${formatDate(maturity)}`]
              .filter(Boolean)
              .map((x, i) => (
                <span key={i}>
                  {i > 0 && <span className="text-muted"> · </span>}
                  {x}
                </span>
              ))}
          </span>
        )}
      </span>
    </span>
  );
}
