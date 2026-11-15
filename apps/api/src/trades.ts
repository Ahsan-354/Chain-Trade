import { id } from 'ethers';
import type { Trade, TradeSide } from '@prisma/client';
import { z } from 'zod';
import { db } from './config.js';
import { balances, exchange, manifest, provision, sendTrade, syncChain } from './chain.js';
import { signingWallet } from './auth.js';
import { amountSchema, bad, chainWrite, decimal, ONE, symbols, units } from './shared.js';

export const tradeSchema = z.object({
  symbol: z.enum(symbols),
  quantity: amountSchema,
  expectedPrice: amountSchema,
  requestId: z.string().uuid(),
});
export type TradeInput = z.infer<typeof tradeSchema>;
export function tradeView(trade: Trade) {
  return {
    id: trade.id,
    symbol: trade.symbol,
    side: trade.side,
    quantity: trade.quantity.toFixed(),
    price: trade.price.toFixed(),
    total: trade.total.toFixed(),
    txHash: trade.txHash,
    blockNumber: trade.blockNumber,
    executedAt: trade.executedAt,
    status: 'Confirmed',
  };
}

export function executeTrade(userId: string, side: TradeSide, input: TradeInput) {
  return chainWrite(async () => {
    const wallet = await db.wallet.findUniqueOrThrow({ where: { userId } });
    if (!wallet.readyAt) throw bad('Finish setting up your wallet by signing in again.', 409);
    const key = id(userId + ':' + input.requestId.toLowerCase());
    const quantity = units(input.quantity);
    const price = units(input.expectedPrice);
    const existing = await db.tradeOrder.findUnique({ where: { key } });
    if (
      existing &&
      (existing.symbol !== input.symbol ||
        existing.side !== side ||
        units(existing.quantity) !== quantity ||
        units(existing.price) !== price)
    ) {
      throw bad('This order reference is already in use. Review a new order.', 409);
    }
    const receipt = async (trade: Trade) => ({
      trade: tradeView(trade),
      balance: decimal((await balances(wallet.address)).cash),
    });
    await syncChain();
    const previous = await db.trade.findUnique({ where: { orderKey: key } });
    if (previous) return receipt(previous);
    if (await exchange.filled(wallet.address, key))
      throw bad('Your order was mined. Retry this confirmation to retrieve the receipt.', 503);
    if (await exchange.paused())
      throw bad('Trading is paused. Keep this order open and retry after trading resumes.', 409);
    if ((await exchange.prices(manifest.assets[input.symbol])) !== price)
      throw bad('The quote changed. Review the latest price before confirming.', 409);

    const buy = side === 'BUY';
    const total = (quantity * price) / ONE;
    if (total === 0n) throw bad('The order total is too small.');
    const account = await balances(wallet.address);
    if (buy && account.cash < total) throw bad('Insufficient CST. Reduce the order amount.', 409);
    if (!buy && account.positions[input.symbol] < quantity)
      throw bad('Insufficient asset balance. Reduce the quantity.', 409);
    if (!existing) {
      await db.tradeOrder.create({
        data: {
          key,
          userId,
          symbol: input.symbol,
          side,
          quantity: input.quantity,
          price: input.expectedPrice,
        },
      });
    }
    try {
      await provision(wallet.address);
      await sendTrade(
        signingWallet(wallet),
        input.symbol,
        buy,
        quantity,
        price,
        key,
        buy ? total : quantity,
      );
    } catch {
      if (!(await exchange.filled(wallet.address, key))) {
        throw bad(
          'The blockchain could not confirm this order. Check market status and retry this confirmation.',
          503,
        );
      }
    }
    try {
      await syncChain();
      return await receipt(await db.trade.findUniqueOrThrow({ where: { orderKey: key } }));
    } catch {
      throw bad('The order was mined. Retry this confirmation to retrieve the saved receipt.', 503);
    }
  });
}
