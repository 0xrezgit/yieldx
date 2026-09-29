'use client';

import type { ReactNode } from 'react';
import { ArrowDownToLine, BadgeDollarSign, Coins, Droplets, Gift, Hourglass, Layers, Lock, Repeat, Sparkles, Star, Wallet } from 'lucide-react';
import { PROTOCOLS, shortAddress } from '../../lib/registry/identity';
import { ACTION, TOKEN_TYPE, merklNetwork } from '../../lib/merkl/rules';
import { flags, leadToken, type Flag } from '../../lib/merkl/estimate';
import type { MerklAction, MerklChain, MerklOpportunity, MerklProtocol, MerklToken, MerklTokenType } from '../../lib/merkl/types';
import type { ProtocolId } from '../../types/protocol';
import { TokenLogo } from '../ui/token-logo';
import { Num } from '../ui/num';
import { formatNumber } from '../../lib/utils/formatting';
import { Pill } from '../opportunities/parts';
import type { Tone } from '../ui/badge';

/** Network logo: the app's local copy when it has one, otherwise Merkl's. */
export function ChainLogo({ chain, size = 16 }: { chain: MerklChain; size?: number }) {
  const n = merklNetwork(chain);
  return <TokenLogo src={n.logo} name={n.name} size={size} />;
}

/** Protocol logo: local for the protocols YieldX already knows, Merkl's otherwise; a generic mark when there is no protocol. */
export function ProtocolLogo({ protocol, size = 16 }: { protocol: MerklProtocol | null; size?: number }) {
  if (!protocol) {
    return (
      <span className="grid place-items-center rounded-md bg-elevated text-muted shrink-0" style={{ width: size, height: size, minWidth: size }} aria-hidden>
        <Layers size={Math.round(size * 0.7)} />
      </span>
    );
  }
  const local = PROTOCOLS[protocol.id as ProtocolId]?.logo;
  return <TokenLogo src={local || protocol.icon} name={protocol.name} size={size} square />;
}

export const protocolName = (p: MerklProtocol | null) => p?.name ?? 'پروتکل نامشخص';

const ACTION_ICON: Record<MerklAction, typeof Coins> = {
  LEND: ArrowDownToLine,
  POOL: Droplets,
  HOLD: Wallet,
  BORROW: BadgeDollarSign,
  DROP: Gift,
  SWAP: Repeat,
  STAKE: Lock,
  LONG: Sparkles,
  SHORT: Sparkles,
  OTHER: Sparkles,
};

export function ActionIcon({ action, size = 14 }: { action: MerklAction; size?: number }) {
  const Icon = ACTION_ICON[action];
  return <Icon size={size} aria-hidden />;
}

export function ActionPill({ action }: { action: MerklAction }) {
  return (
    <span className="inline-flex items-center gap-1 rounded px-1.5 min-h-6 text-xs font-medium whitespace-nowrap bg-elevated text-secondary" title={ACTION[action].hint}>
      <ActionIcon action={action} size={12} /> {ACTION[action].label}
    </span>
  );
}

const TYPE_ICON: Record<MerklTokenType, typeof Coins> = { TOKEN: Coins, POINT: Star, PRETGE: Hourglass };
const TYPE_TONE: Record<MerklTokenType, string> = { TOKEN: 'text-secondary', POINT: 'text-info', PRETGE: 'text-warning' };

export function TokenTypeIcon({ type, size = 12 }: { type: MerklTokenType; size?: number }) {
  const Icon = TYPE_ICON[type];
  return <Icon size={size} className={TYPE_TONE[type]} aria-hidden />;
}

/** Symbols of the deposit tokens — the opportunity's short title. */
export function title(o: MerklOpportunity): string {
  const syms = [...new Set(o.tokens.filter((t) => t.type === 'TOKEN').map((t) => t.symbol))].slice(0, 3);
  return syms.length ? syms.join(' / ') : o.name;
}

/** Up to two token logos, overlapped, with the network badge on the corner. */
function StackedLogos({ o, size }: { o: MerklOpportunity; size: number }) {
  const withIcon = o.tokens.filter((t) => t.type === 'TOKEN');
  const lead = leadToken(o);
  const second = withIcon.find((t) => t !== lead && t.icon && o.action === 'POOL');
  const b = Math.round(size * 0.45);
  const net = merklNetwork(o.chain);
  return (
    <span className="relative shrink-0" style={{ width: second ? size * 1.45 : size, height: size }}>
      {second && (
        <span className="absolute top-0" style={{ insetInlineStart: size * 0.45 }}>
          <TokenLogo src={second.icon} name={second.symbol} size={size} />
        </span>
      )}
      <span className="absolute top-0 rounded-full ring-2 ring-surface" style={{ insetInlineStart: 0 }}>
        <TokenLogo src={lead?.icon} name={lead?.symbol ?? o.name} size={size} />
      </span>
      <span className="absolute rounded-full ring-2 ring-surface bg-surface" style={{ insetInlineStart: -Math.round(b / 3), bottom: -Math.round(b / 3), width: b, height: b }} title={net.nameFa}>
        <TokenLogo src={net.logo} name={net.name} size={b} />
      </span>
    </span>
  );
}

/**
 * Opportunities that would look identical in a list (same tokens, protocol, network
 * and activity — e.g. two vaults of one curator). Their rows also show the address.
 */
export function lookAlikes(list: MerklOpportunity[]): Set<string> {
  const key = (o: MerklOpportunity) => `${title(o)}|${o.protocol?.id}|${o.chain.id}|${o.action}`;
  const n = new Map<string, number>();
  for (const o of list) n.set(key(o), (n.get(key(o)) ?? 0) + 1);
  return new Set(list.filter((o) => (n.get(key(o)) ?? 0) > 1).map((o) => o.id));
}

/** Token symbols, then protocol · network · activity — each with its own logo or icon. */
export function OppIdentity({ o, size = 28, showId = false }: { o: MerklOpportunity; size?: number; showId?: boolean }) {
  const net = merklNetwork(o.chain);
  return (
    <span className="flex items-center gap-2.5 min-w-0" title={o.name}>
      <StackedLogos o={o} size={size} />
      <span className="min-w-0 flex flex-col leading-tight gap-1">
        <span className="flex items-baseline gap-1.5 min-w-0">
          <bdi dir="ltr" className="truncate text-[15px] font-semibold text-primary">
            {title(o)}
          </bdi>
          {showId && o.identifier && (
            <bdi dir="ltr" className="shrink-0 text-xs text-muted num" title={o.identifier}>
              {shortAddress(o.identifier)}
            </bdi>
          )}
        </span>
        <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-secondary min-w-0">
          <span className="inline-flex items-center gap-1 min-w-0">
            <ProtocolLogo protocol={o.protocol} size={14} />
            <bdi dir="ltr" className="truncate">{protocolName(o.protocol)}</bdi>
          </span>
          <span className="text-muted">·</span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <ChainLogo chain={o.chain} size={14} /> {net.nameFa}
          </span>
          <span className="text-muted">·</span>
          <span className="inline-flex items-center gap-1 whitespace-nowrap">
            <ActionIcon action={o.action} size={12} /> {ACTION[o.action].label}
          </span>
        </span>
      </span>
    </span>
  );
}

/** Distinct reward tokens of the live campaigns. */
export function rewardTokens(o: MerklOpportunity): MerklToken[] {
  const seen = new Map<string, MerklToken>();
  for (const c of o.campaigns) seen.set(`${c.rewardToken.chainId}:${c.rewardToken.address.toLowerCase()}`, c.rewardToken);
  return [...seen.values()];
}

export function RewardToken({ t, size = 16, children }: { t: MerklToken; size?: number; children?: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap min-w-0" title={`${t.name} · ${TOKEN_TYPE[t.type]}`}>
      <TokenLogo src={t.icon} name={t.symbol} size={size} />
      <bdi dir="ltr" className="truncate">{t.symbol}</bdi>
      {t.type !== 'TOKEN' && <TokenTypeIcon type={t.type} />}
      {children}
    </span>
  );
}

export function RewardChips({ o, max = 3 }: { o: MerklOpportunity; max?: number }) {
  const list = rewardTokens(o);
  return (
    <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
      {list.slice(0, max).map((t) => (
        <RewardToken key={`${t.chainId}:${t.address}`} t={t} />
      ))}
      {list.length > max && <Num className="text-xs text-muted">+{formatNumber(list.length - max, 0)}</Num>}
    </span>
  );
}

const FLAG_TONE: Record<Flag['tone'], Tone> = { danger: 'danger', warning: 'warning', info: 'muted' };

export function FlagPills({ o, max = 4 }: { o: MerklOpportunity; max?: number }) {
  const list = flags(o);
  if (!list.length) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {list.slice(0, max).map((f) => (
        <Pill key={f.label} tone={FLAG_TONE[f.tone]}>
          {f.label}
        </Pill>
      ))}
      {list.length > max && <Pill><Num>+{formatNumber(list.length - max, 0)}</Num></Pill>}
    </span>
  );
}
