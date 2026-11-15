import type { Trade } from '@prisma/client';
import { balances } from './chain.js';
import { db } from './config.js';
import { periods, sample } from './market.js';
import type { Range } from './market.js';
import { decimal, midnight, ONE, percent, START, symbols, units } from './shared.js';
import type { Symbol } from './shared.js';
import type { Identity } from './auth.js';

type Position = { quantity: bigint; cost: bigint };
function emptyPositions() {
  return Object.fromEntries(symbols.map((s) => [s, { quantity: 0n, cost: 0n }])) as Record<
    Symbol,
    Position
  >;
}

function applyTrade(positions: Record<Symbol, Position>, trade: Trade) {
  const position = positions[trade.symbol as Symbol];
  const quantity = units(trade.quantity);
  const total = units(trade.total);
  if (trade.side === 'BUY') {
    position.quantity += quantity;
    position.cost += total;
    return -total;
  }
  position.cost -= position.quantity ? (position.cost * quantity) / position.quantity : 0n;
  position.quantity -= quantity;
  return total;
}

const userTrades = (userId: string) =>
  db.trade.findMany({ where: { userId }, orderBy: { blockNumber: 'asc' } });
const currentPrices = () =>
  db.asset
    .findMany()
    .then(
      (rows) =>
        Object.fromEntries(rows.map((row) => [row.symbol, units(row.price)])) as Record<
          Symbol,
          bigint
        >,
    );

async function priceAt(symbol: Symbol, at: Date) {
  const row = await db.priceSnapshot.findFirst({
    where: { symbol, observedAt: { lte: at } },
    orderBy: [{ observedAt: 'desc' }, { blockNumber: { sort: 'desc', nulls: 'last' } }],
  });
  return row ? units(row.price) : 0n;
}

export async function portfolio(user: Pick<Identity, 'id' | 'address' | 'createdAt'>) {
  const today = midnight();
  const [live, trades, prices, openingPrices] = await Promise.all([
    balances(user.address),
    userTrades(user.id),
    currentPrices(),
    Promise.all(symbols.map((symbol) => priceAt(symbol, today))),
  ]);
  const positions = emptyPositions();
  const morning = emptyPositions();
  let openingCash = START;
  for (const trade of trades) {
    applyTrade(positions, trade);
    if (trade.executedAt < today) openingCash += applyTrade(morning, trade);
  }
  const opening = symbols.reduce(
    (sum, symbol, i) => sum + (morning[symbol].quantity * openingPrices[i]) / ONE,
    openingCash,
  );
  const value = symbols.reduce(
    (sum, symbol) => sum + (live.positions[symbol] * prices[symbol]) / ONE,
    live.cash,
  );
  const holdings = symbols.map((symbol) => {
    const quantity = live.positions[symbol];
    const price = prices[symbol];
    const cost = positions[symbol].cost;
    const positionValue = (quantity * price) / ONE;
    return {
      symbol,
      quantity: decimal(quantity),
      price: decimal(price),
      averageBuy: decimal(quantity ? (cost * ONE) / quantity : 0n),
      value: decimal(positionValue),
      unrealized: decimal(positionValue - cost),
      allocation: percent(positionValue, value),
    };
  });
  return {
    balance: decimal(live.cash),
    value: decimal(value),
    pnl: decimal(value - START),
    roi: percent(value - START, START),
    today: decimal(value - opening),
    todayPercent: percent(value - opening, opening),
    cashAllocation: percent(live.cash, value),
    holdings,
  };
}

export async function performance(user: Identity, range: Range) {
  const now = Math.max(Date.now(), user.createdAt.getTime());
  const from = Math.max(user.createdAt.getTime(), now - periods[range]);
  const [trades, snapshots, basePrices] = await Promise.all([
    userTrades(user.id),
    db.priceSnapshot.findMany({
      where: { observedAt: { gt: new Date(from), lte: new Date(now) } },
      orderBy: [{ observedAt: 'asc' }, { blockNumber: { sort: 'asc', nulls: 'first' } }],
    }),
    Promise.all(symbols.map((symbol) => priceAt(symbol, new Date(from)))),
  ]);
  const marks = Object.fromEntries(symbols.map((symbol, i) => [symbol, basePrices[i]])) as Record<
    Symbol,
    bigint
  >;
  const positions = emptyPositions();
  let cash = START;
  const events = [
    ...trades.map((trade) => ({ at: trade.executedAt.getTime(), trade })),
    ...snapshots.map((snapshot) => ({ at: snapshot.observedAt.getTime(), snapshot })),
  ].sort((a, b) => a.at - b.at);
  let cursor = 0;
  const points = [
    ...new Set([from, ...events.map((e) => e.at).filter((at) => at > from && at < now), now]),
  ];
  return sample(
    points.map((time) => {
      while (cursor < events.length && events[cursor].at <= time) {
        const event = events[cursor++];
        if ('trade' in event) cash += applyTrade(positions, event.trade);
        else marks[event.snapshot.symbol as Symbol] = units(event.snapshot.price);
      }
      const value = symbols.reduce(
        (sum, symbol) => sum + (positions[symbol].quantity * marks[symbol]) / ONE,
        cash,
      );
      return { time, value: decimal(value) };
    }),
    180,
  );
}

export const badges = [
  {
    code: 'first',
    title: 'First Trade',
    description: 'Make your first move in the market.',
    condition: 'Complete one trade',
    target: 1,
  },
  {
    code: 'explorer',
    title: 'Explorer',
    description: 'Try each of the three simulated markets.',
    condition: 'Trade all three assets',
    target: 3,
  },
  {
    code: 'momentum',
    title: 'Momentum',
    description: 'Build a consistent practice routine.',
    condition: 'Complete five trades',
    target: 5,
  },
  {
    code: 'profitable',
    title: 'Profitable Day',
    description: 'Grow your starting capital through trading.',
    condition: 'Reach a positive portfolio return',
    target: 1,
  },
  {
    code: 'top-ten',
    title: 'Top Ten Trader',
    description: 'Earn a place among the leading traders.',
    condition: 'Complete a trade and reach the top ten',
    target: 1,
  },
  {
    code: 'builder',
    title: 'Portfolio Builder',
    description: 'Grow your portfolio beyond 15,000 CST.',
    condition: 'Exceed 15,000 CST in portfolio value',
    target: 15000,
  },
];

function badgeProgress(
  code: string,
  value: bigint,
  count: number,
  distinct: number,
  rank: number | undefined,
) {
  switch (code) {
    case 'first':
    case 'momentum':
      return count;
    case 'explorer':
      return distinct;
    case 'profitable':
      return Number(value > START);
    case 'top-ten':
      return Number(count > 0 && rank !== undefined && rank <= 10);
    case 'builder':
      return Number(value / ONE);
    default:
      return 0;
  }
}

async function ranking() {
  const [traders, prices] = await Promise.all([
    db.user.findMany({
      where: { role: 'USER', wallet: { readyAt: { not: null } } },
      select: {
        id: true,
        name: true,
        createdAt: true,
        wallet: { select: { address: true } },
        trades: { select: { symbol: true } },
        achievements: { select: { code: true } },
      },
    }),
    currentPrices(),
  ]);
  const marked = await Promise.all(
    traders.map(async (user) => {
      const live = await balances(user.wallet!.address);
      const value = symbols.reduce(
        (sum, symbol) => sum + (live.positions[symbol] * prices[symbol]) / ONE,
        live.cash,
      );
      return { ...user, value };
    }),
  );
  return marked.sort((a, b) =>
    a.value === b.value
      ? a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
      : a.value > b.value
        ? -1
        : 1,
  );
}

export async function refreshBadges() {
  const ranked = await ranking();
  const admins = await db.user.findMany({
    where: { role: 'ADMIN', wallet: { readyAt: { not: null } } },
    select: {
      id: true,
      createdAt: true,
      wallet: { select: { address: true } },
      trades: { select: { symbol: true } },
      achievements: { select: { code: true } },
    },
  });
  const participants = [
    ...ranked.map((user, i) => ({ ...user, rank: i + 1 })),
    ...(await Promise.all(
      admins.map(async (user) => ({
        ...user,
        rank: undefined,
        value: units(
          (
            await portfolio({
              id: user.id,
              address: user.wallet!.address,
              createdAt: user.createdAt,
            })
          ).value,
        ),
      })),
    )),
  ];
  const grants = participants.flatMap((user) =>
    badges
      .filter(({ code, target }) => {
        const progress = badgeProgress(
          code,
          user.value,
          user.trades.length,
          new Set(user.trades.map((t) => t.symbol)).size,
          user.rank,
        );
        return (
          (code === 'builder' ? user.value > 15_000n * ONE : progress >= target) &&
          !user.achievements.some((b) => b.code === code)
        );
      })
      .map((badge) => ({ userId: user.id, code: badge.code })),
  );
  if (grants.length) await db.userAchievement.createMany({ data: grants, skipDuplicates: true });
}

export async function leaderboard(userId: string) {
  return (await ranking()).map((user, i) => ({
    rank: i + 1,
    name: user.name,
    value: decimal(user.value),
    roi: percent(user.value - START, START),
    trades: user.trades.length,
    badges: user.achievements.length,
    isYou: user.id === userId,
  }));
}

export async function achievements(user: Identity) {
  const [earned, trades, position, ranked] = await Promise.all([
    db.userAchievement.findMany({ where: { userId: user.id } }),
    userTrades(user.id),
    portfolio(user),
    ranking(),
  ]);
  const index = ranked.findIndex((row) => row.id === user.id);
  return badges.map((badge) => ({
    ...badge,
    progress: Math.min(
      badge.target,
      badgeProgress(
        badge.code,
        units(position.value),
        trades.length,
        new Set(trades.map((t) => t.symbol)).size,
        index < 0 ? undefined : index + 1,
      ),
    ),
    unlockedAt: earned.find((row) => row.code === badge.code)?.unlockedAt ?? null,
  }));
}

export async function seedBadges() {
  await db.$transaction(
    badges.map((badge) =>
      db.achievement.upsert({ where: { code: badge.code }, create: badge, update: badge }),
    ),
  );
}
