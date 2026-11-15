import { randomInt } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { PriceSnapshot } from '@prisma/client';
import { z } from 'zod';
import { db } from './config.js';
import { exchange, manifest, setOnChainPrices, setPaused, syncChain } from './chain.js';
import {
  amountSchema,
  assetInfo,
  bad,
  chainWrite,
  day,
  hour,
  percent,
  symbols,
  units,
} from './shared.js';
import type { Symbol } from './shared.js';

export const ranges = ['1H', '24H', '7D', 'All'] as const;
export type Range = (typeof ranges)[number];
export const periods = { '1H': hour, '24H': day, '7D': 7 * day, All: Infinity };
export const updates = new EventEmitter().setMaxListeners(0);
export const priceSchema = z
  .object({
    BTCX: amountSchema.optional(),
    ETHX: amountSchema.optional(),
    SOLX: amountSchema.optional(),
  })
  .strict()
  .refine((input) => Object.values(input).some(Boolean), 'Enter at least one price.');

export function sample<T>(rows: T[], limit: number) {
  if (rows.length <= limit) return rows;
  return Array.from(
    { length: limit },
    (_, i) => rows[Math.floor((i * (rows.length - 1)) / (limit - 1))],
  );
}

export function snapshotView(snapshot: PriceSnapshot) {
  return { time: snapshot.observedAt.getTime(), value: snapshot.price.toFixed() };
}

export async function history(symbol: Symbol, range: Range) {
  const since = range === 'All' ? undefined : new Date(Date.now() - periods[range]);
  const [rows, prior] = await Promise.all([
    db.priceSnapshot.findMany({
      where: { symbol, observedAt: { gte: since } },
      orderBy: [{ observedAt: 'asc' }, { blockNumber: 'asc' }],
    }),
    since &&
      db.priceSnapshot.findFirst({
        where: { symbol, observedAt: { lt: since } },
        orderBy: [{ observedAt: 'desc' }, { blockNumber: { sort: 'desc', nulls: 'last' } }],
      }),
  ]);
  const points = sample(rows.map(snapshotView), 240);
  if (prior && since) points.unshift({ time: since.getTime(), value: prior.price.toFixed() });
  return points;
}

export async function markets() {
  const rows = await db.asset.findMany();
  const cutoff = new Date(Date.now() - day);
  return Promise.all(
    symbols.map(async (symbol) => {
      const asset = rows.find((a) => a.symbol === symbol)!;
      const [baseline, window] = await Promise.all([
        db.priceSnapshot.findFirst({
          where: { symbol, observedAt: { lte: cutoff } },
          orderBy: [{ observedAt: 'desc' }, { blockNumber: { sort: 'desc', nulls: 'last' } }],
        }),
        history(symbol, '24H'),
      ]);
      const current = units(asset.price);
      const base = baseline ? units(baseline.price) : null;
      return {
        symbol,
        name: asset.name,
        description: asset.description,
        price: asset.price.toFixed(),
        min: asset.min.toFixed(),
        max: asset.max.toFixed(),
        change: base ? percent(current - base, base) : null,
        sparkline: sample(window, 30),
      };
    }),
  );
}

export async function marketState() {
  const [state, snapshot] = await Promise.all([
    db.chainState.findUniqueOrThrow({ where: { id: manifest.id } }),
    db.priceSnapshot.findFirst({
      orderBy: [{ observedAt: 'desc' }, { blockNumber: { sort: 'desc', nulls: 'last' } }],
      select: { observedAt: true },
    }),
  ]);
  return { paused: state.paused, updatedAt: snapshot?.observedAt, intervalSeconds: 30 };
}

export function updatePrices(userId?: string, manual?: Partial<Record<Symbol, string>>) {
  return chainWrite(async () => {
    const prices: Partial<Record<Symbol, bigint>> = {};
    for (const symbol of symbols) {
      const min = units(assetInfo[symbol].min);
      const max = units(assetInfo[symbol].max);
      if (manual) {
        const raw = manual[symbol];
        if (!raw) continue;
        const value = units(raw);
        if (value < min || value > max)
          throw bad(
            symbol +
              ' must be between ' +
              assetInfo[symbol].min +
              ' and ' +
              assetInfo[symbol].max +
              ' CST.',
          );
        prices[symbol] = value;
        continue;
      }
      const current: bigint = await exchange.prices(manifest.assets[symbol]);
      const next = (current * BigInt(10_000 + randomInt(-300, 301))) / 10_000n;
      prices[symbol] = next < min ? min : next > max ? max : next;
    }
    await setOnChainPrices(prices);
    await syncChain();
    if (manual)
      await db.auditLog.create({ data: { userId, action: 'PRICES_UPDATED', metadata: manual } });
  });
}

export function changeMarket(userId: string, paused: boolean) {
  return chainWrite(async () => {
    await setPaused(paused);
    await syncChain();
    await db.auditLog.create({
      data: { userId, action: paused ? 'MARKET_PAUSED' : 'MARKET_RESUMED', metadata: {} },
    });
    updates.emit('market');
    return marketState();
  });
}
