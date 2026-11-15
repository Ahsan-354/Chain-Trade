import { randomUUID } from 'node:crypto';
import bcrypt from 'bcrypt';
import { parseEther } from 'ethers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp, tick } from '../src/app.js';
import { signingWallet } from '../src/auth.js';
import { bootstrapChain, cst, exchange, manifest, provider } from '../src/chain.js';
import { db, env } from '../src/config.js';

const password = 'Practice-2026-API!';
const email = 'api-test-' + randomUUID() + '@chaintrade.local';
const app = createApp();
const user = request.agent(app);
const admin = request.agent(app);

beforeAll(async () => {
  await bootstrapChain();
  await user
    .post('/api/auth/register')
    .send({ name: 'API Test Trader', email, password, confirmPassword: password })
    .expect(201);
  await admin
    .post('/api/auth/login')
    .send({ email: env.SEED_ADMIN_EMAIL, password: env.SEED_ADMIN_PASSWORD })
    .expect(200);
}, 30_000);
afterAll(async () => {
  provider.destroy();
  await db.$disconnect();
});

describe('ChainTrade API with PostgreSQL and Hardhat', () => {
  it('creates a unique encrypted wallet, hashes the password, and funds the wallet', async () => {
    const account = await db.user.findUniqueOrThrow({
      where: { email },
      include: { wallet: true },
    });
    const wallet = account.wallet!;
    expect(wallet.readyAt).not.toBeNull();
    expect(account.passwordHash).not.toBe(password);
    expect(await bcrypt.compare(password, account.passwordHash)).toBe(true);
    expect(wallet.encryptedKey).toMatch(/^[a-f0-9]{24}\.[a-f0-9]{32}\.[a-f0-9]+$/);
    expect(signingWallet(wallet).address).toBe(wallet.address);
    expect(await cst.balanceOf(wallet.address)).toBe(parseEther('10000'));
    expect(await provider.getBalance(wallet.address)).toBeGreaterThan(0n);
    const res = await user.get('/api/auth/me').expect(200);
    expect(res.body.data).toMatchObject({ name: 'API Test Trader', balance: '10000.0' });
    expect(res.body.data.wallet).toMatch(/^0x[a-f0-9]{4}…[a-f0-9]{4}$/i);
    expect(JSON.stringify(res.body)).not.toContain(wallet.address);
    expect(JSON.stringify(res.body)).not.toContain(wallet.encryptedKey);
    const other = await request(app)
      .post('/api/auth/register')
      .send({
        name: 'API Test Trader Two',
        email: 'test-' + randomUUID() + '@chaintrade.local',
        password,
        confirmPassword: password,
      })
      .expect(201);
    expect(other.body.data.wallet).not.toBe(res.body.data.wallet);
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Repeat Trader', email, password, confirmPassword: password })
      .expect(409);
  });

  it('validates registration and returns field-specific messages', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'T', email: 'invalid', password: 'weak', confirmPassword: 'wrong' })
      .expect(400);
    expect(res.body.error.fields).toMatchObject({
      name: expect.any(String),
      email: expect.any(String),
      password: expect.any(String),
    });
  });

  it('logs in with a protected cookie, rejects wrong credentials, and revokes a logged-out session', async () => {
    const res = await request(app).post('/api/auth/login').send({ email, password }).expect(200);
    const cookie = String(res.headers['set-cookie'][0]);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    const header = cookie.split(';')[0];
    await request(app).get('/api/auth/me').set('Cookie', header).expect(200);
    await request(app).post('/api/auth/logout').set('Cookie', header).send({}).expect(200);
    await request(app).get('/api/auth/me').set('Cookie', header).expect(401);
    await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'wrong-password' })
      .expect(401);
  });

  it('rejects unauthorized trades, disallowed origins, and non-admin market actions', async () => {
    await request(app).post('/api/trades/buy').send({}).expect(401);
    await user.post('/api/trades/buy').set('Origin', 'https://example.com').send({}).expect(403);
    await user.post('/api/admin/prices').send({ BTCX: '68000' }).expect(403);
    await user.get('/api/admin/users').expect(403);
  });

  it('validates quantities for buys and sells, stale quotes, and available funds', async () => {
    const base = { symbol: 'BTCX', expectedPrice: '68420', requestId: randomUUID() };
    for (const quantity of ['0', '-2', '0.0000000000000000001', '1e5', 1]) {
      await user
        .post('/api/trades/buy')
        .send({ ...base, quantity })
        .expect(400);
      await user
        .post('/api/trades/sell')
        .send({ ...base, quantity })
        .expect(400);
    }
    await user
      .post('/api/trades/buy')
      .send({ ...base, quantity: '1' })
      .expect(409);
    await user
      .post('/api/trades/sell')
      .send({ ...base, quantity: '1' })
      .expect(409);
    const res = await user
      .post('/api/trades/buy')
      .send({ ...base, expectedPrice: '1', quantity: '1' })
      .expect(409);
    expect(res.body.error.message).toMatch(/quote changed/i);
  });

  it('stores real event receipts for buys and sells, deduplicates retries, and updates portfolio and badges', async () => {
    for (const [symbol, expectedPrice, quantity] of [
      ['BTCX', '68420', '0.01'],
      ['ETHX', '3540', '0.2'],
      ['SOLX', '172', '2'],
    ]) {
      const payload = { symbol, expectedPrice, quantity, requestId: randomUUID() };
      const buy = await user.post('/api/trades/buy').send(payload).expect(201);
      const trade = buy.body.data.trade;
      expect(trade.txHash).toMatch(/^0x[a-f0-9]{64}$/);
      const [saved, receipt] = await Promise.all([
        db.trade.findUniqueOrThrow({ where: { txHash: trade.txHash } }),
        provider.getTransactionReceipt(trade.txHash),
      ]);
      expect(receipt?.blockNumber).toBe(saved.blockNumber);
      expect(receipt?.status).toBe(1);
      expect(saved.symbol).toBe(symbol);
      expect(
        receipt?.logs.some(
          (log) =>
            log.address === manifest.exchange &&
            exchange.interface.parseLog(log)?.name === 'TradeExecuted',
        ),
      ).toBe(true);
      const duplicate = await user.post('/api/trades/buy').send(payload).expect(201);
      expect(duplicate.body.data.trade.txHash).toBe(trade.txHash);
      await user.post('/api/trades/sell').send(payload).expect(409);
    }
    await user
      .post('/api/trades/sell')
      .send({ symbol: 'SOLX', expectedPrice: '172', quantity: '1', requestId: randomUUID() })
      .expect(201);
    const p = await user.get('/api/portfolio').expect(200);
    expect(p.body.data.holdings.find((h: { symbol: string }) => h.symbol === 'SOLX').quantity).toBe(
      '1.0',
    );
    expect(p.body.data.value).toBe('10000.0');
    const history = await user.get('/api/trades/history?side=SELL&symbol=SOLX').expect(200);
    expect(history.body.data.total).toBe(1);
    const badges = await user.get('/api/achievements/me').expect(200);
    expect(
      badges.body.data.find((b: { code: string }) => b.code === 'explorer').unlockedAt,
    ).toBeTruthy();
    const ranked = await user.get('/api/leaderboard').expect(200);
    expect(ranked.body.data.find((r: { isYou: boolean }) => r.isYou).trades).toBe(4);
  }, 30_000);

  it('changes market prices and pause state on-chain and records market history', async () => {
    try {
      await admin.post('/api/admin/prices').send({ BTCX: '1' }).expect(400);
      await admin.post('/api/admin/prices').send({ BTCX: '70001.125' }).expect(200);
      expect(await exchange.prices(manifest.assets.BTCX)).toBe(parseEther('70001.125'));
      await admin.post('/api/admin/market/pause').send({}).expect(200);
      await user
        .post('/api/trades/buy')
        .send({
          symbol: 'BTCX',
          expectedPrice: '70001.125',
          quantity: '0.01',
          requestId: randomUUID(),
        })
        .expect(409);
      await admin.post('/api/admin/market/resume').send({}).expect(200);
      const historical = await user.get('/api/market/assets/BTCX/history?range=All').expect(200);
      expect(historical.body.data.some((p: { value: string }) => p.value === '70001.125')).toBe(
        true,
      );
      await tick();
      const baseline = parseEther('70001.125');
      const price: bigint = await exchange.prices(manifest.assets.BTCX);
      expect(price).toBeGreaterThanOrEqual((baseline * 97n) / 100n);
      expect(price).toBeLessThanOrEqual((baseline * 103n) / 100n);
      expect(
        await db.priceSnapshot.count({ where: { source: { startsWith: '0x' } } }),
      ).toBeGreaterThanOrEqual(12);
    } finally {
      await admin.post('/api/admin/market/resume').send({}).expect(200);
      await admin
        .post('/api/admin/prices')
        .send({ BTCX: '68420', ETHX: '3540', SOLX: '172' })
        .expect(200);
    }
  }, 30_000);
});
