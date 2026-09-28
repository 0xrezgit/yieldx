import protocols from '../../config/protocols.json';
import type { ProtocolAdapter, ProtocolId } from '../../types/protocol';
import { ExponentAdapter } from './exponent';
import { PendleAdapter } from './pendle';
import { SpectraAdapter } from './spectra';

export * from './base';

const factories: Record<ProtocolId, () => ProtocolAdapter> = {
  exponent: () => new ExponentAdapter(),
  pendle: () => new PendleAdapter(),
  spectra: () => new SpectraAdapter(),
};

export type ProtocolConfig = (typeof protocols)[keyof typeof protocols];

export const PROTOCOL_IDS = Object.keys(factories) as ProtocolId[];

export function isProtocolId(x: string): x is ProtocolId {
  return x in factories;
}

export function getAdapter(id: ProtocolId): ProtocolAdapter {
  return factories[id]();
}

export function getProtocolConfig(id: ProtocolId): ProtocolConfig {
  return protocols[id];
}
