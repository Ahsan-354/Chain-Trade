import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

export const symbols = ['BTCX', 'ETHX', 'SOLX'] as const;
export type Symbol = (typeof symbols)[number];
export const ranges = ['1H', '24H', '7D', 'All'] as const;
export type Range = (typeof ranges)[number];
export type Side = 'BUY' | 'SELL';
export type Profile = {
  id: string;
  name: string;
  email: string;
  role: 'USER' | 'ADMIN';
  wallet: string;
  balance: string;
};
export type Point = { time: number; value: string };
export type Asset = {
  symbol: Symbol;
  name: string;
  description: string;
  price: string;
  change: number | null;
  min: string;
  max: string;
  sparkline: Point[];
};
export type MarketState = { paused: boolean; updatedAt?: string; intervalSeconds: number };
export type Holding = {
  symbol: Symbol;
  quantity: string;
  price: string;
  averageBuy: string;
  value: string;
  unrealized: string;
  allocation: number;
};
export type Portfolio = {
  balance: string;
  value: string;
  pnl: string;
  roi: number;
  today: string;
  todayPercent: number;
  cashAllocation: number;
  holdings: Holding[];
};
export type Trade = {
  id: string;
  symbol: Symbol;
  side: Side;
  quantity: string;
  price: string;
  total: string;
  txHash: string;
  blockNumber: number;
  executedAt: string;
  status: string;
  trader?: string;
};
export type TradePage = { rows: Trade[]; total: number; page: number; pages: number };
export type Receipt = { trade: Trade; balance: string };
export type Ranking = {
  rank: number;
  name: string;
  value: string;
  roi: number;
  trades: number;
  badges: number;
  isYou: boolean;
};
export type Badge = {
  code: string;
  title: string;
  description: string;
  condition: string;
  target: number;
  progress: number;
  unlockedAt: string | null;
};
export type Overview = MarketState & {
  users: number;
  activeUsers: number;
  circulation: string;
  volume: string;
  tradesToday: number;
};
export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  lastActiveAt: string;
  wallet: string | null;
  balance: string | null;
  trades: number;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

const base = import.meta.env.VITE_API_URL?.replace(/\/$/, '') ?? '';
export async function api<T>(path: string, payload?: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(base + '/api' + path, {
      method: payload === undefined ? 'GET' : 'POST',
      credentials: 'include',
      signal,
      headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(503, 'ChainTrade could not be reached. Check the local server and retry.');
  }
  const result = await res.json().catch(() => null);
  if (!res.ok || !result || !('data' in result)) {
    throw new ApiError(
      res.ok ? 503 : res.status,
      result?.error?.message ?? 'ChainTrade is temporarily unavailable.',
      result?.error?.fields,
    );
  }
  return result.data as T;
}

export function useApi<T>(path: string) {
  return useQuery({ queryKey: [path], queryFn: ({ signal }) => api<T>(path, undefined, signal) });
}

export function useMarketFeed() {
  const client = useQueryClient();
  const [online, setOnline] = useState(false);
  useEffect(() => {
    const source = new EventSource(base + '/api/market/stream', { withCredentials: true });
    source.addEventListener('ready', () => {
      setOnline(true);
      void client.invalidateQueries();
    });
    source.addEventListener('market', () => {
      setOnline(true);
      void client.invalidateQueries();
    });
    source.onerror = () => {
      setOnline(false);
      void client.invalidateQueries({ queryKey: ['/auth/me'] });
    };
    return () => source.close();
  }, [client]);
  return online;
}

export const fmt = (value: string | number, digits = 2) =>
  Number(value).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
export const qty = (value: string) =>
  value.includes('.') ? value.replace(/0+$/, '').replace(/\.$/, '') : value;
export const money = (value: string | number) => fmt(value) + ' CST';
export const signed = (value: string | number, suffix = '') =>
  (Number(value) > 0 ? '+' : '') + fmt(value) + suffix;
export const shortHash = (hash: string) => hash.slice(0, 8) + '…' + hash.slice(-5);
export const timeText = (date: string) =>
  new Date(date).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
