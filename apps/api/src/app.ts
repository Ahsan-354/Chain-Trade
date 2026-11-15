import express from 'express';
import type { ErrorRequestHandler, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { rateLimit } from 'express-rate-limit';
import { z, ZodError } from 'zod';
import type { Prisma } from '@prisma/client';
import { db, env } from './config.js';
import {
  adminOnly,
  authenticate,
  endSession,
  loginAccount,
  loginSchema,
  profile,
  registerAccount,
  registerSchema,
  startSession,
} from './auth.js';
import { cst, manifest, syncChain } from './chain.js';
import {
  changeMarket,
  history,
  markets,
  marketState,
  priceSchema,
  ranges,
  updatePrices,
  updates,
} from './market.js';
import { achievements, leaderboard, performance, portfolio, refreshBadges } from './portfolio.js';
import { executeTrade, tradeSchema, tradeView } from './trades.js';
import { bad, day, decimal, HttpError, mask, midnight, symbols, units } from './shared.js';

const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ data });
const emptyBody = z.object({}).strict();
const rangeQuery = z.object({ range: z.enum(ranges).default('24H') });
const date = z.string().date();
const historyQuery = z
  .object({
    symbol: z.enum(symbols).optional(),
    side: z.enum(['BUY', 'SELL']).optional(),
    from: date.optional(),
    to: date.optional(),
    hash: z
      .string()
      .trim()
      .regex(/^(0x)?[0-9a-f]{0,64}$/i)
      .optional(),
    page: z.coerce.number().int().min(1).max(100_000).default(1),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, {
    path: ['to'],
    message: 'End date must be on or after the start date.',
  });
const symbolParam = z.enum(symbols);
const userSelect = { name: true };

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '16kb' }), cookieParser());
  app.use('/api', (_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });
  app.use((req, _res, next) => {
    const origin = req.get('origin');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && origin && origin !== env.WEB_ORIGIN)
      throw bad('Request origin is not allowed.', 403);
    next();
  });
  app.get('/api/health', async (_req, res) => {
    await db.$queryRaw`SELECT 1`;
    ok(res, { ready: true });
  });

  const authLimit = rateLimit({
    windowMs: 15 * 60_000,
    limit: 30,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) =>
      res
        .status(429)
        .json({ error: { message: 'Too many sign-in attempts. Try again in 15 minutes.' } }),
  });
  app.post('/api/auth/register', authLimit, async (req, res) => {
    const user = await registerAccount(registerSchema.parse(req.body));
    await startSession(user, res);
    ok(res, await profile(user, user.wallet!.address), 201);
  });
  app.post('/api/auth/login', authLimit, async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await loginAccount(email, password);
    await startSession(user, res);
    ok(res, await profile(user, user.wallet!.address));
  });

  app.use('/api', authenticate);
  app.get('/api/auth/me', async (req, res) =>
    ok(res, await profile(req.identity, req.identity.address)),
  );
  app.post('/api/auth/logout', async (req, res) => {
    emptyBody.parse(req.body ?? {});
    await endSession(req, res);
    ok(res, { signedOut: true });
  });
  app.get('/api/market/stream', (req, res) => {
    res.set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('event: ready\ndata: {}\n\n');
    const emit = () => res.write('event: market\ndata: {}\n\n');
    const heartbeat = setInterval(() => res.write(': keepalive\n\n'), 15_000);
    updates.on('market', emit);
    req.on('close', () => {
      clearInterval(heartbeat);
      updates.off('market', emit);
    });
  });
  app.get('/api/market/assets', async (_req, res) => ok(res, await markets()));
  app.get('/api/market/summary', async (_req, res) => ok(res, await marketState()));
  app.get('/api/market/assets/:symbol/history', async (req, res) =>
    ok(res, await history(symbolParam.parse(req.params.symbol), rangeQuery.parse(req.query).range)),
  );
  app.post('/api/trades/:side', async (req, res) => {
    const side = z.enum(['buy', 'sell']).parse(req.params.side);
    const receipt = await executeTrade(
      req.identity.id,
      side === 'buy' ? 'BUY' : 'SELL',
      tradeSchema.parse(req.body),
    );
    await refreshBadges();
    updates.emit('market');
    ok(res, receipt, 201);
  });
  app.get('/api/trades/history', async (req, res) => {
    const { symbol, side, hash, from, to, page } = historyQuery.parse(req.query);
    const where: Prisma.TradeWhereInput = {
      userId: req.identity.id,
      symbol,
      side,
      txHash: hash ? { contains: hash.toLowerCase() } : undefined,
      executedAt: {
        gte: from ? new Date(from) : undefined,
        lt: to ? new Date(new Date(to).getTime() + day) : undefined,
      },
    };
    const size = 10;
    const [rows, total] = await db.$transaction([
      db.trade.findMany({
        where,
        orderBy: { blockNumber: 'desc' },
        skip: (page - 1) * size,
        take: size,
      }),
      db.trade.count({ where }),
    ]);
    ok(res, {
      rows: rows.map(tradeView),
      total,
      page,
      pages: Math.max(1, Math.ceil(total / size)),
    });
  });
  app.get('/api/portfolio', async (req, res) => ok(res, await portfolio(req.identity)));
  app.get('/api/portfolio/performance', async (req, res) =>
    ok(res, await performance(req.identity, rangeQuery.parse(req.query).range)),
  );
  app.get('/api/leaderboard', async (req, res) => ok(res, await leaderboard(req.identity.id)));
  app.get('/api/achievements', async (_req, res) =>
    ok(res, await db.achievement.findMany({ orderBy: { title: 'asc' } })),
  );
  app.get('/api/achievements/me', async (req, res) => ok(res, await achievements(req.identity)));

  app.use('/api/admin', adminOnly);
  app.get('/api/admin/overview', async (_req, res) => {
    const [users, activeUsers, supply, reserve, volume, tradesToday, state] = await Promise.all([
      db.user.count(),
      db.user.count({ where: { lastActiveAt: { gte: new Date(Date.now() - day) } } }),
      cst.totalSupply() as Promise<bigint>,
      cst.balanceOf(manifest.exchange) as Promise<bigint>,
      db.trade.aggregate({ _sum: { total: true } }),
      db.trade.count({ where: { executedAt: { gte: midnight() } } }),
      marketState(),
    ]);
    ok(res, {
      users,
      activeUsers,
      circulation: decimal(supply - reserve),
      volume: volume._sum.total ? decimal(units(volume._sum.total)) : '0',
      tradesToday,
      ...state,
    });
  });
  app.get('/api/admin/users', async (_req, res) => {
    const users = await db.user.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        lastActiveAt: true,
        wallet: { select: { address: true, readyAt: true } },
        _count: { select: { trades: true } },
      },
    });
    ok(
      res,
      await Promise.all(
        users.map(async ({ wallet, _count, ...user }) => ({
          ...user,
          trades: _count.trades,
          wallet: wallet ? mask(wallet.address) : null,
          balance: wallet?.readyAt ? decimal(await cst.balanceOf(wallet.address)) : null,
        })),
      ),
    );
  });
  app.get('/api/admin/trades', async (_req, res) => {
    const trades = await db.trade.findMany({
      orderBy: { blockNumber: 'desc' },
      take: 25,
      include: { user: { select: userSelect } },
    });
    ok(
      res,
      trades.map((trade) => ({ ...tradeView(trade), trader: trade.user.name })),
    );
  });
  app.post('/api/admin/prices', async (req, res) => {
    await updatePrices(req.identity.id, priceSchema.parse(req.body));
    await refreshBadges();
    updates.emit('market');
    ok(res, await markets());
  });
  app.post('/api/admin/market/:action', async (req, res) => {
    emptyBody.parse(req.body ?? {});
    const action = z.enum(['pause', 'resume']).parse(req.params.action);
    ok(res, await changeMarket(req.identity.id, action === 'pause'));
  });
  app.use((_req, _res, next) => next(bad('This endpoint does not exist.', 404)));
  const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
    if (error instanceof ZodError) {
      const fields = Object.fromEntries(
        error.issues.map((issue) => [issue.path.join('.') || 'form', issue.message]),
      );
      res.status(400).json({
        error: {
          message: error.issues[0]?.message ?? 'Review the submitted information.',
          fields,
        },
      });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: { message: error.message } });
      return;
    }
    if (error?.type === 'entity.parse.failed' || error?.type === 'entity.too.large') {
      res
        .status(error.status)
        .json({ error: { message: 'Send a valid JSON request under 16 KB.' } });
      return;
    }
    console.error(
      'Request failed',
      req.method,
      req.route?.path ?? req.path,
      error?.name ?? 'Error',
    );
    res.status(503).json({
      error: {
        message: 'ChainTrade is temporarily unavailable. Check the local services and try again.',
      },
    });
  };
  app.use(errorHandler);
  return app;
}

export async function tick() {
  await syncChain();
  await updatePrices();
  await refreshBadges();
  updates.emit('market');
}
