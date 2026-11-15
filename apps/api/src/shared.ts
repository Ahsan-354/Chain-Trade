import { formatEther, parseEther } from 'ethers';
import { z } from 'zod';

export const ONE = 10n ** 18n;
export const START = 10_000n * ONE;
export const units = (amount: string | { toFixed(): string }) =>
  parseEther(typeof amount === 'string' ? amount : amount.toFixed());
export const decimal = (amount: bigint) => formatEther(amount);
export const percent = (difference: bigint, base: bigint) =>
  base === 0n ? 0 : Number((difference * 10_000n) / base) / 100;
export const mask = (address: string) => address.slice(0, 6) + '…' + address.slice(-4);
export const hour = 3_600_000;
export const day = 24 * hour;
export const midnight = (now = new Date()) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

export const symbols = ['BTCX', 'ETHX', 'SOLX'] as const;
export type Symbol = (typeof symbols)[number];
export const assetInfo = {
  BTCX: {
    name: 'Bitcoin',
    description: 'A synthetic market that models a Bitcoin position against CST.',
    start: '68420',
    min: '15000',
    max: '180000',
  },
  ETHX: {
    name: 'Ethereum',
    description: 'A synthetic market that models an Ethereum position against CST.',
    start: '3540',
    min: '600',
    max: '16000',
  },
  SOLX: {
    name: 'Solana',
    description: 'A synthetic market that models a Solana position against CST.',
    start: '172',
    min: '20',
    max: '1200',
  },
};
export const amountSchema = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,18})?$/, 'Use a positive decimal with up to 18 decimal places.')
  .refine((v) => {
    try {
      return parseEther(v) > 0n;
    } catch {
      return false;
    }
  }, 'Enter an amount greater than zero.');

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export const bad = (message: string, status = 400) => new HttpError(status, message);

let writeTail = Promise.resolve();
export function chainWrite<T>(operation: () => Promise<T>): Promise<T> {
  // A single local API writer serializes deployer and user nonces across requests and market ticks.
  const result = writeTail.then(operation);
  writeTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}
