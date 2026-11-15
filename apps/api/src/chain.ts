import { readFileSync } from 'node:fs';
import { Contract, JsonRpcProvider, Wallet, parseEther } from 'ethers';
import type { EventLog } from 'ethers';
import { z } from 'zod';
import { db, env } from './config.js';
import { assetInfo, decimal, symbols } from './shared.js';
import type { Symbol } from './shared.js';

const abiToken = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];
const abiCst = [
  ...abiToken,
  'function grantStarter(address)',
  'function funded(address) view returns (bool)',
  'function totalSupply() view returns (uint256)',
];
const abiExchange = [
  'function deploymentId() view returns (bytes32)',
  'function owner() view returns (address)',
  'function prices(address) view returns (uint256)',
  'function paused() view returns (bool)',
  'function filled(address,bytes32) view returns (bool)',
  'function setPrices(address[],uint256[])',
  'function pause()',
  'function resume()',
  'function trade(address,bool,uint256,uint256,bytes32)',
  'event TradeExecuted(address indexed trader,address indexed asset,bytes32 indexed orderId,bool isBuy,uint256 quantity,uint256 price,uint256 total)',
  'event PriceUpdated(address indexed asset,uint256 previousPrice,uint256 price)',
];
const deploymentSchema = z.object({
  id: z.string().regex(/^0x[a-f\d]{64}$/i),
  chainId: z.literal(31337),
  startBlock: z.number().int().positive(),
  cst: z.string(),
  exchange: z.string(),
  assets: z.object({ BTCX: z.string(), ETHX: z.string(), SOLX: z.string() }),
});
export const manifest = deploymentSchema.parse(
  JSON.parse(
    readFileSync(new URL('../../../packages/contracts/deployment.json', import.meta.url), 'utf8'),
  ),
);
export const provider = new JsonRpcProvider(env.RPC_URL, 31337, { cacheTimeout: -1 });
export const cst = new Contract(manifest.cst, abiCst, provider);
export const exchange = new Contract(manifest.exchange, abiExchange, provider);
export const tokens = Object.fromEntries(
  symbols.map((symbol) => [symbol, new Contract(manifest.assets[symbol], abiToken, provider)]),
) as Record<Symbol, Contract>;

async function adminSigner() {
  const owner: string = await exchange.owner();
  return provider.getSigner(owner);
}
export async function bootstrapChain() {
  if ((await exchange.deploymentId()) !== manifest.id)
    throw new Error('Hardhat deployment mismatch. See README reset steps.');
  await db.$transaction(async (tx) => {
    const saved = await tx.chainState.findFirst();
    if (saved && saved.id !== manifest.id)
      throw new Error(
        'PostgreSQL belongs to a different Hardhat deployment. See README reset steps.',
      );
    await tx.chainState.upsert({
      where: { id: manifest.id },
      create: { id: manifest.id, lastBlock: manifest.startBlock - 1 },
      update: {},
    });
    for (const symbol of symbols) {
      const { name, description, min, max, start } = assetInfo[symbol];
      await tx.asset.upsert({
        where: { symbol },
        update: {},
        create: {
          symbol,
          name,
          description,
          min,
          max,
          price: start,
          address: manifest.assets[symbol],
        },
      });
    }
  });
  await syncChain();
}

export async function provision(address: string) {
  const admin = await adminSigner();
  if ((await provider.getBalance(address)) < parseEther('0.01')) {
    await (await admin.sendTransaction({ to: address, value: parseEther('0.05') })).wait();
  }
  if (!(await cst.funded(address))) {
    const writable = new Contract(manifest.cst, abiCst, admin);
    await (await writable.grantStarter(address)).wait();
  }
}

export async function setOnChainPrices(prices: Partial<Record<Symbol, bigint>>) {
  const entries = symbols.filter((symbol) => prices[symbol] !== undefined);
  const writable = new Contract(manifest.exchange, abiExchange, await adminSigner());
  await (
    await writable.setPrices(
      entries.map((s) => manifest.assets[s]),
      entries.map((s) => prices[s]),
    )
  ).wait();
}
export async function setPaused(paused: boolean) {
  if (Boolean(await exchange.paused()) === paused) return;
  const writable = new Contract(manifest.exchange, abiExchange, await adminSigner());
  await (await (paused ? writable.pause() : writable.resume())).wait();
}
export async function sendTrade(
  wallet: Wallet,
  symbol: Symbol,
  buy: boolean,
  quantity: bigint,
  price: bigint,
  key: string,
  spend: bigint,
) {
  const token = new Contract(buy ? manifest.cst : manifest.assets[symbol], abiToken, wallet);
  if ((await token.allowance(wallet.address, manifest.exchange)) < spend) {
    await (await token.approve(manifest.exchange, spend)).wait();
  }
  const writable = new Contract(manifest.exchange, abiExchange, wallet);
  await (await writable.trade(manifest.assets[symbol], buy, quantity, price, key)).wait();
}

export async function balances(address: string) {
  const values: bigint[] = await Promise.all([
    cst.balanceOf(address),
    ...symbols.map((s) => tokens[s].balanceOf(address)),
  ]);
  return {
    cash: values[0],
    positions: Object.fromEntries(symbols.map((s, i) => [s, values[i + 1]])) as Record<
      Symbol,
      bigint
    >,
  };
}

let indexing: Promise<void> | undefined;
export async function syncChain() {
  if (indexing) await indexing;
  if (indexing) return indexing;
  indexing = indexEvents().finally(() => {
    indexing = undefined;
  });
  return indexing;
}

async function indexEvents() {
  const state = await db.chainState.findUniqueOrThrow({ where: { id: manifest.id } });
  const head = await provider.getBlockNumber();
  if (head < state.lastBlock) throw new Error('Hardhat chain was reset. See README reset steps.');
  if (head === state.lastBlock) return;

  for (let from = state.lastBlock + 1; from <= head; from += 500) {
    const to = Math.min(head, from + 499);
    const [prices, trades, paused] = await Promise.all([
      exchange.queryFilter(exchange.filters.PriceUpdated(), from, to),
      exchange.queryFilter(exchange.filters.TradeExecuted(), from, to),
      exchange.paused({ blockTag: to }) as Promise<boolean>,
    ]);
    const events = [...prices, ...trades]
      .filter((log): log is EventLog => 'args' in log)
      .sort((a, b) => a.blockNumber - b.blockNumber || a.index - b.index);
    const times = new Map(
      await Promise.all(
        [...new Set(events.map((log) => log.blockNumber))].map(async (number) => {
          const block = await provider.getBlock(number);
          if (!block) throw new Error('An indexed block could not be retrieved.');
          return [number, new Date(block.timestamp * 1000)] as const;
        }),
      ),
    );

    // The cursor only advances when all projections for this block range commit.
    await db.$transaction(
      async (tx) => {
        for (const event of events) {
          const assetAddress = String(event.args.asset).toLowerCase();
          const symbol = symbols.find((s) => manifest.assets[s].toLowerCase() === assetAddress);
          if (!symbol) continue;
          const observedAt = times.get(event.blockNumber)!;
          const price = decimal(event.args.price);
          if (event.eventName === 'PriceUpdated') {
            const source = event.transactionHash + ':' + event.index;
            await tx.priceSnapshot.upsert({
              where: { source },
              update: {},
              create: { source, symbol, price, observedAt, blockNumber: event.blockNumber },
            });
            await tx.asset.update({ where: { symbol }, data: { price } });
            continue;
          }
          const wallet = await tx.wallet.findUnique({
            where: { address: String(event.args.trader) },
          });
          if (!wallet) continue;
          const txHash = event.transactionHash;
          await tx.trade.upsert({
            where: { txHash },
            update: {},
            create: {
              txHash,
              userId: wallet.userId,
              symbol,
              price,
              blockNumber: event.blockNumber,
              executedAt: observedAt,
              side: event.args.isBuy ? 'BUY' : 'SELL',
              orderKey: event.args.orderId,
              quantity: decimal(event.args.quantity),
              total: decimal(event.args.total),
            },
          });
        }
        await tx.chainState.update({ where: { id: manifest.id }, data: { lastBlock: to, paused } });
      },
      { timeout: 30_000 },
    );
  }
}
