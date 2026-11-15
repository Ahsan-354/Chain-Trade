import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
export const env = z
  .object({
    DATABASE_URL: z.string().url(),
    RPC_URL: z
      .string()
      .url()
      .refine(
        (value) => ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(value).hostname),
        'Use the local Hardhat node',
      ),
    WEB_ORIGIN: z.string().url(),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
    JWT_SECRET: z.string().min(32),
    WALLET_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
    SEED_ADMIN_EMAIL: z.string().email(),
    SEED_ADMIN_PASSWORD: z.string().min(10),
    SEED_TRADER_PASSWORD: z.string().min(10),
  })
  .parse(process.env);
export const db = new PrismaClient();
