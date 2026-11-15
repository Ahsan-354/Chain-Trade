import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { Wallet } from 'ethers';
import type { Request, Response, NextFunction } from 'express';
import type { Role, User, Wallet as StoredWallet } from '@prisma/client';
import { z } from 'zod';
import { db, env } from './config.js';
import { cst, provider, provision } from './chain.js';
import { bad, chainWrite, day, decimal, mask } from './shared.js';

const key = Buffer.from(env.WALLET_ENCRYPTION_KEY, 'hex');
const cookie = 'chaintrade_session';
const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: env.WEB_ORIGIN.startsWith('https:'),
  path: '/',
};
const password = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .refine((value) => Buffer.byteLength(value) <= 72, 'Use at most 72 bytes.');
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z
    .string()
    .min(1)
    .refine((v) => Buffer.byteLength(v) <= 72),
});
export const registerSchema = loginSchema
  .extend({
    name: z.string().trim().min(2, 'Enter your full name.').max(80),
    password,
    confirmPassword: password,
  })
  .refine((v) => v.password === v.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords must match.',
  });

export type Identity = {
  id: string;
  name: string;
  email: string;
  role: Role;
  address: string;
  createdAt: Date;
};
declare module 'express-serve-static-core' {
  interface Request {
    identity: Identity;
    sessionId: string;
  }
}

function encrypt(privateKey: string, address: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv).setAAD(Buffer.from(address));
  const data = Buffer.concat([cipher.update(privateKey, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString('hex')).join('.');
}

export function signingWallet(wallet: StoredWallet) {
  const [iv, tag, encrypted] = wallet.encryptedKey
    .split('.')
    .map((part) => Buffer.from(part, 'hex'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
    .setAAD(Buffer.from(wallet.address))
    .setAuthTag(tag);
  const signer = new Wallet(
    Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8'),
    provider,
  );
  if (signer.address !== wallet.address)
    throw new Error('Stored wallet does not match the signer.');
  return signer;
}

type Account = User & { wallet: StoredWallet | null };
export async function ensureWallet(user: Account) {
  const stored = user.wallet;
  if (!stored) throw new Error('Account has no assigned wallet.');
  if (stored.readyAt) return stored;
  return chainWrite(async () => {
    try {
      await provision(stored.address);
    } catch {
      throw bad(
        'Wallet setup is temporarily unavailable. Sign in with this account to retry.',
        503,
      );
    }
    return db.wallet.update({ where: { userId: user.id }, data: { readyAt: new Date() } });
  });
}

const dummyHash = bcrypt.hashSync(randomBytes(32).toString('hex'), 11);

export async function registerAccount(
  input: { name: string; email: string; password: string },
  role: Role = 'USER',
) {
  const existing = await db.user.findUnique({
    where: { email: input.email },
    include: { wallet: true },
  });
  if (existing) {
    if (
      !existing.wallet?.readyAt &&
      (await bcrypt.compare(input.password, existing.passwordHash))
    ) {
      await ensureWallet(existing);
      return existing;
    }
    throw bad('This email is already registered. Sign in to continue.', 409);
  }
  const wallet = Wallet.createRandom();
  const passwordHash = await bcrypt.hash(input.password, 11);
  let user: Account;
  try {
    user = await db.user.create({
      data: {
        name: input.name,
        email: input.email,
        passwordHash,
        role,
        wallet: {
          create: {
            address: wallet.address,
            encryptedKey: encrypt(wallet.privateKey, wallet.address),
          },
        },
        auditLogs: { create: { action: 'REGISTERED', metadata: {} } },
      },
      include: { wallet: true },
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
      throw bad('This email is already registered. Sign in to continue.', 409);
    }
    throw error;
  }
  await ensureWallet(user);
  return user;
}

export async function loginAccount(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email }, include: { wallet: true } });
  const correct = await bcrypt.compare(password, user?.passwordHash ?? dummyHash);
  if (!user || !correct) throw bad('Email or password is incorrect.', 401);
  await ensureWallet(user);
  return user;
}
export async function startSession(user: Account, res: Response) {
  const expiresAt = new Date(Date.now() + day);
  const [session] = await db.$transaction([
    db.session.create({ data: { userId: user.id, expiresAt } }),
    db.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } }),
    db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
  ]);
  res.cookie(
    cookie,
    jwt.sign({ sid: session.id }, env.JWT_SECRET, {
      subject: user.id,
      expiresIn: '1d',
      algorithm: 'HS256',
    }),
    { ...cookieOptions, expires: expiresAt },
  );
}
export async function endSession(req: Request, res: Response) {
  await db.session.deleteMany({ where: { id: req.sessionId } });
  res.clearCookie(cookie, cookieOptions);
}
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  let sessionId: string;
  let subject: string;
  try {
    const claims = jwt.verify(req.cookies[cookie] ?? '', env.JWT_SECRET, { algorithms: ['HS256'] });
    if (
      typeof claims === 'string' ||
      typeof claims.sid !== 'string' ||
      typeof claims.sub !== 'string'
    )
      throw Error();
    sessionId = claims.sid;
    subject = claims.sub;
  } catch {
    throw bad('Sign in to continue.', 401);
  }
  const session = await db.session.findUnique({
    where: { id: sessionId },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true,
          lastActiveAt: true,
          wallet: { select: { address: true, readyAt: true } },
        },
      },
    },
  });
  if (
    !session ||
    session.userId !== subject ||
    session.expiresAt <= new Date() ||
    !session.user.wallet?.readyAt
  )
    throw bad('Your session has expired. Sign in again.', 401);
  const { id, name, email, role, createdAt, wallet, lastActiveAt } = session.user;
  req.identity = { id, name, email, role, createdAt, address: wallet.address };
  req.sessionId = session.id;
  if (Date.now() - lastActiveAt.getTime() > 300_000)
    await db.user.update({ where: { id }, data: { lastActiveAt: new Date() } });
  next();
}
export function adminOnly(req: Request, _res: Response, next: NextFunction) {
  if (req.identity.role !== 'ADMIN') throw bad('Administrator access is required.', 403);
  next();
}
export async function profile(
  user: Pick<Identity, 'id' | 'name' | 'email' | 'role'>,
  address: string,
) {
  const { id, name, email, role } = user;
  return {
    id,
    name,
    email,
    role,
    wallet: mask(address),
    balance: decimal(await cst.balanceOf(address)),
  };
}
