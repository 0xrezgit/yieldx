import protocols from '../../config/protocols.json';
import type { ProtocolId } from '../../types/protocol';
import { networkByName, type Network } from './networks';

/**
 * Identity of protocols, markets and tokens. Four separate concepts:
 * - protocol: where the trade happens (Pendle)
 * - project / platform: who issues the asset (Ethena) — free text from the API
 * - network: the chain (Ethereum) — see networks.ts
 * - token: the asset (sUSDe) — identified by network + contract address / mint,
 *   never by its symbol alone (the same symbol exists on many chains).
 */
export interface ProtocolIdentity {
  id: ProtocolId;
  name: string;
  nameFa: string;
  logo: string;
}

export const PROTOCOLS: Record<ProtocolId, ProtocolIdentity> = {
  pendle: { id: 'pendle', name: protocols.pendle.name, nameFa: protocols.pendle.nameFa, logo: '/logos/protocols/pendle.webp' },
  exponent: { id: 'exponent', name: protocols.exponent.name, nameFa: protocols.exponent.nameFa, logo: '/logos/protocols/exponent.webp' },
  spectra: { id: 'spectra', name: protocols.spectra.name, nameFa: protocols.spectra.nameFa, logo: '/logos/protocols/spectra.webp' },
};

export const protocolIdentity = (id: ProtocolId): ProtocolIdentity =>
  PROTOCOLS[id] ?? { id, name: String(id), nameFa: String(id), logo: '' };

/** Stable market key: protocol + network + market id (ids are already network-scoped). */
export const marketKey = (protocol: ProtocolId, marketId: string) => `${protocol}:${marketId}`;

/**
 * Stable token key: network key + address. EVM addresses are case-insensitive and
 * lower-cased; Solana mints are case-sensitive and kept exactly as given.
 */
export function tokenKey(network: Network, address: string): string {
  return `${network.key}/${network.namespace === 'eip155' ? address.toLowerCase() : address}`;
}

export function tokenKeyFor(chainName: string, address: string): string {
  return tokenKey(networkByName(chainName), address);
}

/** «0x1234…abcd» — for display only; the full value stays available to copy. */
export const shortAddress = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
