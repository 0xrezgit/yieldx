import type { MarketData, MarketSummary } from '../../types/market';
import type { ProtocolId } from '../../types/protocol';
import { BaseAdapter, LiveDataUnavailableError } from './base';

/**
 * Protocols without a verified public API. All analysis still works — the user
 * enters PT/YT prices and APYs by hand — only the data-fetching methods refuse.
 */
export class ManualAdapter extends BaseAdapter {
  liveData = false;

  constructor(
    public id: ProtocolId,
    public name: string,
  ) {
    super();
  }

  async listMarkets(): Promise<MarketSummary[]> {
    throw new LiveDataUnavailableError(this.name, 'market list');
  }

  async fetchMarketData(): Promise<MarketData> {
    throw new LiveDataUnavailableError(this.name);
  }

  async getHistoricalAPY(): Promise<number[]> {
    throw new LiveDataUnavailableError(this.name, 'APY history');
  }
}

export const SpectraAdapter = () => new ManualAdapter('spectra', 'Spectra');
export const SenseAdapter = () => new ManualAdapter('sense', 'Sense');
