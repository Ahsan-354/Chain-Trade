import { createHash } from 'node:crypto';
import { ensureWallet, registerAccount } from './auth.js';
import {
  bootstrapChain,
  exchange,
  manifest,
  provider,
  setOnChainPrices,
  syncChain,
} from './chain.js';
import { db, env } from './config.js';
import { refreshBadges, seedBadges } from './portfolio.js';
import { assetInfo, day, decimal, hour, symbols, units } from './shared.js';
import { executeTrade } from './trades.js';
import type { Symbol } from './shared.js';
import type { Role, TradeSide } from '@prisma/client';

const names = [
  'Maya Patel',
  'Omar Farooq',
  'Leila Haddad',
  'Daniel Kim',
  'Sofia Reyes',
  'Hassan Iqbal',
  'Amara Okafor',
  'Elena Rossi',
  'Nadia Rahman',
  'Ethan Brooks',
  'Inez Costa',
  'Jonas Meyer',
];
const starter = Object.fromEntries(symbols.map((s) => [s, units(assetInfo[s].start)])) as Record<
  Symbol,
  bigint
>;
const fixedId = (value: string) => {
  const hash = createHash('sha256').update(value).digest('hex');
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    '4' + hash.slice(13, 16),
    'a' + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join('-');
};

async function account(name: string, email: string, password: string, role: Role) {
  const existing = await db.user.findUnique({ where: { email }, include: { wallet: true } });
  if (!existing) return registerAccount({ name, email, password }, role);
  if (existing.role !== role)
    throw new Error('A seed email already belongs to an account with a different role.');
  await ensureWallet(existing);
  return existing;
}

async function main() {
  await bootstrapChain();
  await seedBadges();
  const marker = await db.auditLog.findFirst({ where: { action: 'DEMO_SEEDED' } });
  if (marker) {
    console.log('Demo data is already seeded.');
    return;
  }
  if (await exchange.paused()) throw new Error('Resume the market before seeding.');
  const block = await provider.getBlock(manifest.startBlock);
  if (!block) throw new Error('Deployment block unavailable.');
  const anchor = block.timestamp * 1000;
  const snapshots = symbols.flatMap((symbol, index) => {
    const offsets = [
      ...Array.from({ length: 25 }, (_, i) => (28 - i) * 6 * hour),
      ...Array.from({ length: 46 }, (_, i) => ((47 - i) * hour) / 2),
      ...Array.from({ length: 11 }, (_, i) => ((11 - i) * hour) / 12),
    ];
    return offsets.map((offset, i) => {
      const direction = [1, -1, 1][index];
      const wave = Math.round(120 * Math.sin(i * 0.72 + index) + 70 * Math.sin(i * 1.88 + index));
      const slope = Math.round(direction * (1 - i / offsets.length) * (240 + index * 65));
      return {
        symbol,
        source: 'seed:' + symbol + ':' + i,
        observedAt: new Date(anchor - Math.min(7 * day, offset)),
        price: decimal((starter[symbol] * BigInt(10_000 - slope + wave)) / 10_000n),
      };
    });
  });
  await db.priceSnapshot.createMany({ data: snapshots, skipDuplicates: true });

  const admin = await account(
    'Demo Admin',
    env.SEED_ADMIN_EMAIL.trim().toLowerCase(),
    env.SEED_ADMIN_PASSWORD,
    'ADMIN',
  );
  const users = [];
  for (const name of names)
    users.push(
      await account(
        name,
        name.toLowerCase().replace(' ', '.') + '@chaintrade.local',
        env.SEED_TRADER_PASSWORD,
        'USER',
      ),
    );
  async function order(
    userId: string,
    symbol: Symbol,
    side: TradeSide,
    quantity: string,
    phase: string,
    price: bigint,
  ) {
    await executeTrade(userId, side, {
      symbol,
      quantity,
      expectedPrice: decimal(price),
      requestId: fixedId(userId + symbol + side + phase),
    });
  }
  const opening = { BTCX: units('66450'), ETHX: units('3690'), SOLX: units('158') };
  await setOnChainPrices(opening);
  await syncChain();
  for (const [i, user] of [admin, ...users].entries()) {
    for (const [j, symbol] of symbols.entries()) {
      if (i > 1 && (i + j) % 3 === 0) continue;
      const quantity =
        j === 0
          ? '0.0' + (2 + (i % 5))
          : j === 1
            ? '0.' + (2 + ((i * 3) % 7))
            : String(3 + ((i * 5) % 13));
      await order(user.id, symbol, 'BUY', quantity, 'opening', opening[symbol]);
    }
  }
  await setOnChainPrices(starter);
  await syncChain();
  for (const user of [admin, ...users.slice(0, 4)]) {
    const holding = await db.trade.findFirst({
      where: { userId: user.id, side: 'BUY', symbol: 'SOLX' },
    });
    if (holding) await order(user.id, 'SOLX', 'SELL', '1', 'closing', starter.SOLX);
  }
  await order(users[0].id, 'BTCX', 'BUY', '0.003', 'closing', starter.BTCX);
  await refreshBadges();
  await db.auditLog.create({
    data: { userId: admin.id, action: 'DEMO_SEEDED', metadata: { users: users.length } },
  });
  console.log(
    'Seeded',
    users.length,
    'traders, an administrator, historical market data, and on-chain trades.',
  );
}

main()
  .catch((error) => {
    console.error('Seed failed:', error instanceof Error ? error.message : 'Unknown error');
    process.exitCode = 1;
  })
  .finally(async () => {
    provider.destroy();
    await db.$disconnect();
  });
