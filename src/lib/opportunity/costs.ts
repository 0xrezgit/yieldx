import type { CostItem, Opportunity } from '../../types/opportunity';
import type { GasQuote } from '../merkl/types';
import { GAS_UNITS } from '../merkl/profit';
import { formatNumber } from '../utils/formatting';

/**
 * Network costs without asking the user: gas units per step × the gas price and
 * native-token price measured on the server (Merkl feed). Where no quote exists
 * (Solana, a chain the feed does not cover) a stated default is used and labelled
 * «فرض» — never zero.
 */

export type Step = keyof typeof GAS_UNITS;

/** USD per transaction when no measured quote exists. */
export const FALLBACK_TX_USD = { ethereum: 1, evm: 0.05, solana: 0.01 } as const;

export const evmChainId = (chain: string): number | null => {
  const m = /^eip155:(\d+)$/.exec(chain);
  return m ? Number(m[1]) : null;
};

export function txCost(chain: string, steps: Step[], gas: GasQuote[]): { usd: number; basis: CostItem['basis'] } {
  const id = evmChainId(chain);
  const q = id === null ? undefined : gas.find((g) => g.chainId === id);
  if (q && q.gwei > 0 && q.nativeUsd > 0) {
    const units = steps.reduce((a, s) => a + GAS_UNITS[s], 0);
    return { usd: units * q.gwei * 1e-9 * q.nativeUsd, basis: 'model' };
  }
  const per = id === null ? FALLBACK_TX_USD.solana : id === 1 ? FALLBACK_TX_USD.ethereum : FALLBACK_TX_USD.evm;
  return { usd: steps.length * per, basis: 'assumed' };
}

/** One claim transaction on a chain id (Merkl distribution chain). */
export const claimCost = (gas: GasQuote[]) => (chainId: number) => txCost(`eip155:${chainId}`, ['claim'], gas).usd;

const STEPS: Record<string, { entry: Step[]; exit: Step[] }> = {
  lend: { entry: ['approve', 'deposit'], exit: ['withdraw'] },
  vault: { entry: ['approve', 'deposit'], exit: ['withdraw'] },
  'fixed-lend': { entry: ['approve', 'deposit'], exit: ['withdraw'] },
  pt: { entry: ['approve', 'swap'], exit: ['withdraw'] },
  // Buy YT; at maturity claim the accrued yield.
  yt: { entry: ['approve', 'swap'], exit: ['claim'] },
  // Supply collateral, borrow, swap back (one flash-loan route or several rounds: the lower count is used).
  leverage: { entry: ['approve', 'deposit', 'deposit', 'swap'], exit: ['swap', 'deposit', 'withdraw'] },
};

/** Entry and exit gas for an opportunity, as cost lines. */
export function gasLines(o: Opportunity, gas: GasQuote[]): { entry: CostItem[]; exit: CostItem[] } {
  const steps = STEPS[o.family] ?? STEPS.lend;
  const e = txCost(o.chain, steps.entry, gas);
  const x = txCost(o.chain, steps.exit, gas);
  return {
    entry: [{ key: 'gas-entry', label: `گس ورود (${formatNumber(steps.entry.length, 0)} تراکنش)`, usd: e.usd, basis: e.basis }],
    exit: [{ key: 'gas-exit', label: `گس خروج (${formatNumber(steps.exit.length, 0)} تراکنش)`, usd: x.usd, basis: x.basis }],
  };
}
