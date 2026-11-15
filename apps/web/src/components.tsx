import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowDownLeft,
  ArrowUpRight,
  Award,
  Bitcoin,
  Check,
  CircleAlert,
  Compass,
  Layers3,
  LoaderCircle,
  Medal,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { fmt, money, qty, ranges, shortHash, signed, timeText } from './api';
import type { Asset, Point, Range, Symbol, Trade } from './api';

export function Logo() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <Layers3 size={21} />
      </span>
      <span>ChainTrade</span>
    </div>
  );
}
export function AssetIcon({ symbol }: { symbol: Symbol | 'CST' }) {
  return (
    <span className={'asset-icon asset-' + symbol.toLowerCase()} aria-hidden="true">
      {symbol === 'BTCX' ? (
        <Bitcoin size={19} />
      ) : symbol === 'ETHX' ? (
        <span className="eth-mark">♦</span>
      ) : symbol === 'SOLX' ? (
        <span className="sol-mark">
          <i />
          <i />
          <i />
        </span>
      ) : (
        <Layers3 size={17} />
      )}
    </span>
  );
}
export function AssetLabel({ symbol, name }: { symbol: Symbol; name?: string }) {
  return (
    <span className="asset-label">
      <AssetIcon symbol={symbol} />
      <span>
        <strong>{name ?? symbol}</strong>
        {name && <small>{symbol}</small>}
      </span>
    </span>
  );
}
export function Delta({ value, suffix = '%' }: { value: number | string | null; suffix?: string }) {
  if (value === null) return <span className="muted">—</span>;
  return (
    <span className={Number(value) > 0 ? 'gain' : Number(value) < 0 ? 'loss' : 'muted'}>
      {signed(value, suffix)}
    </span>
  );
}
export function Status({ paused, online = true }: { paused?: boolean; online?: boolean }) {
  const label = paused ? 'Trading paused' : online ? 'Market live' : 'Reconnecting';
  return (
    <span className={'market-status ' + (paused || !online ? 'standby' : '')}>
      <i />
      {label}
    </span>
  );
}
export function Notice({
  children,
  tone = 'error',
}: {
  children: ReactNode;
  tone?: 'error' | 'info' | 'success';
}) {
  return (
    <div className={'notice ' + tone} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'success' ? <Check size={17} /> : <CircleAlert size={17} />}
      <span>{children}</span>
    </div>
  );
}
export function Pending({ label = 'Loading account data…' }: { label?: string }) {
  return (
    <div className="state-box" role="status">
      <LoaderCircle className="animate-spin" size={20} />
      {label}
    </div>
  );
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children && <div>{children}</div>}
    </div>
  );
}
export function Retry({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="state-box">
      <Notice>{error.message}</Notice>
      <button className="btn secondary" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
export function Section({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-title">
      <div>
        <h2>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
export function PageTitle({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function Metric({
  label,
  value,
  children,
  icon,
}: {
  label: string;
  value: ReactNode;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="panel metric">
      <div className="metric-label">
        {label}
        {icon && <span>{icon}</span>}
      </div>
      <strong>{value}</strong>
      {children && <div className="metric-note">{children}</div>}
    </div>
  );
}
export function RangeTabs({ value, change }: { value: Range; change: (range: Range) => void }) {
  return (
    <div className="segmented" aria-label="Chart time range">
      {ranges.map((range) => (
        <button
          key={range}
          type="button"
          aria-pressed={range === value}
          onClick={() => change(range)}
        >
          {range}
        </button>
      ))}
    </div>
  );
}
export function Sparkline({ points, negative }: { points: Point[]; negative?: boolean }) {
  return (
    <div className="sparkline" aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <LineChart data={points.map((p) => ({ ...p, value: Number(p.value) }))}>
          <YAxis hide domain={['dataMin', 'dataMax']} />
          <Line
            type="linear"
            dataKey="value"
            dot={false}
            stroke={negative ? '#a14a4a' : '#47714b'}
            strokeWidth={1.75}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
export function ValueChart({ points, range }: { points: Point[]; range: Range }) {
  const id = useId().replace(/:/g, '');
  if (points.length < 2)
    return (
      <Empty title="Waiting for more data">
        The chart will appear after another price snapshot.
      </Empty>
    );
  const elapsed = points[points.length - 1].time - points[0].time;
  const shortWindow = elapsed < 600_000;
  const timeOptions: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  if (shortWindow) timeOptions.second = '2-digit';
  const label = (value: number) =>
    new Date(value).toLocaleString(
      'en-US',
      elapsed <= 86_400_000 || range === '1H' || range === '24H'
        ? timeOptions
        : { month: 'short', day: 'numeric' },
    );
  return (
    <div className="value-chart" aria-label="Historical CST value chart">
      <ResponsiveContainer width="100%" height="100%" minWidth={0}>
        <AreaChart
          data={points.map((p) => ({ time: p.time, value: Number(p.value) }))}
          margin={{ top: 9, right: 15, bottom: 1, left: 4 }}
        >
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5b7b40" stopOpacity={0.24} />
              <stop offset="100%" stopColor="#5b7b40" stopOpacity={0.025} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#344a3226" strokeDasharray="3 4" />
          <XAxis
            dataKey="time"
            type="number"
            scale="time"
            domain={['dataMin', 'dataMax']}
            tickFormatter={label}
            tickLine={false}
            axisLine={false}
            minTickGap={45}
            tick={{ fill: '#4c5848', fontSize: 11 }}
            tickMargin={10}
          />
          <YAxis
            domain={[
              (n: number) => Math.max(0, Math.floor(n * 0.997)),
              (n: number) => Math.ceil(n * 1.003),
            ]}
            width={58}
            tickCount={4}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => fmt(v, 0)}
            tick={{ fill: '#4c5848', fontSize: 11 }}
          />
          <Tooltip
            labelFormatter={(v) => label(Number(v))}
            formatter={(v) => [money(Number(v)), 'Value']}
            cursor={{ stroke: '#77866c', strokeDasharray: '4 4' }}
            contentStyle={{ borderRadius: 12, border: '1px solid #dce1d6', fontSize: 12 }}
          />
          <Area
            type="linear"
            dataKey="value"
            stroke="#385835"
            strokeWidth={2.25}
            activeDot={{ r: 4, fill: '#385835', stroke: '#f8faef', strokeWidth: 2 }}
            fill={'url(#' + id + ')'}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
export function MarketCards({ assets }: { assets: Asset[] }) {
  return (
    <div className="markets-grid">
      {assets.map((asset) => (
        <Link
          className="panel market-card"
          to={'/markets/' + asset.symbol}
          data-asset={asset.symbol}
          key={asset.symbol}
        >
          <div className="spread">
            <AssetLabel symbol={asset.symbol} name={asset.name} />
            <ArrowUpRight size={18} aria-hidden="true" />
          </div>
          <div className="market-card-price">
            <div>
              <strong>{fmt(asset.price)}</strong> <small>CST</small>
              <div className="market-card-delta">
                <Delta value={asset.change} /> <span className="muted">24h</span>
              </div>
            </div>
            <Sparkline points={asset.sparkline} negative={(asset.change ?? 0) < 0} />
          </div>
        </Link>
      ))}
    </div>
  );
}
export function Modal({
  title,
  children,
  close,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const element = ref.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      className="modal"
      aria-labelledby={id}
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
    >
      <div className="spread modal-heading">
        <h2 id={id}>{title}</h2>
        <button aria-label="Close dialog" className="icon-btn" onClick={close} disabled={busy}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function TradeDetails({ trade }: { trade: Trade }) {
  const [copied, setCopied] = useState(false);
  return (
    <>
      <dl className="details">
        <div>
          <dt>Order</dt>
          <dd>
            {trade.side === 'BUY' ? 'Buy' : 'Sell'} {trade.symbol}
          </dd>
        </div>
        <div>
          <dt>Quantity</dt>
          <dd>
            {qty(trade.quantity)} {trade.symbol}
          </dd>
        </div>
        <div>
          <dt>Executed price</dt>
          <dd>{money(trade.price)}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd>{money(trade.total)}</dd>
        </div>
        <div>
          <dt>Executed</dt>
          <dd>{timeText(trade.executedAt)}</dd>
        </div>
        <div>
          <dt>Block / status</dt>
          <dd>
            #{trade.blockNumber} · {trade.status}
          </dd>
        </div>
      </dl>
      <div className="hash-box">
        <div className="spread">
          <strong>Transaction hash</strong>
          <button
            className="text-link"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(trade.txHash);
                setCopied(true);
              } catch {
                setCopied(false);
              }
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <code>{trade.txHash}</code>
      </div>
    </>
  );
}
export function TradesTable({ trades, compact = false }: { trades: Trade[]; compact?: boolean }) {
  const [active, setActive] = useState<Trade>();
  if (!trades.length)
    return (
      <Empty title="No trades to show">
        {compact ? (
          <Link to="/markets" className="text-link">
            Explore markets
          </Link>
        ) : (
          'Completed trades appear here. Try adjusting your filters.'
        )}
      </Empty>
    );
  return (
    <>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Trade transactions">
        <table role="table">
          <thead role="rowgroup">
            <tr role="row">
              {[
                'Date / time',
                'Type',
                'Asset',
                'Quantity',
                ...(!compact ? ['Executed price'] : []),
                'Total',
                'Transaction',
                ...(!compact ? ['Status'] : []),
              ].map((column) => (
                <th scope="col" role="columnheader" key={column}>
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {trades.map((trade) => (
              <tr key={trade.id} role="row">
                <td data-label="Date / time" role="cell">
                  {timeText(trade.executedAt)}
                  {trade.trader && <small className="block muted">{trade.trader}</small>}
                </td>
                <td data-label="Type" role="cell">
                  <span className={'trade-side ' + trade.side.toLowerCase()}>
                    {trade.side === 'BUY' ? (
                      <ArrowDownLeft size={13} />
                    ) : (
                      <ArrowUpRight size={13} />
                    )}{' '}
                    {trade.side === 'BUY' ? 'Buy' : 'Sell'}
                  </span>
                </td>
                <td data-label="Asset" role="cell">
                  <strong>{trade.symbol}</strong>
                </td>
                <td data-label="Quantity" role="cell">
                  {qty(trade.quantity)}
                </td>
                {!compact && (
                  <td data-label="Executed price" role="cell">
                    {money(trade.price)}
                  </td>
                )}
                <td data-label="Total" role="cell">
                  {money(trade.total)}
                </td>
                <td data-label="Transaction" role="cell">
                  <button
                    className="text-link hash-link"
                    aria-label={'View transaction ' + trade.txHash}
                    onClick={() => setActive(trade)}
                  >
                    {shortHash(trade.txHash)}
                  </button>
                </td>
                {!compact && (
                  <td data-label="Status" role="cell">
                    <span className="confirmed">
                      <Check size={13} /> {trade.status}
                    </span>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {active && (
        <Modal title="Transaction details" close={() => setActive(undefined)}>
          <TradeDetails trade={active} />
        </Modal>
      )}
    </>
  );
}
const badgeIcons = {
  first: Zap,
  explorer: Compass,
  momentum: TrendingUp,
  profitable: Award,
  'top-ten': Medal,
  builder: Layers3,
};
export function BadgeIcon({ code, unlocked = false }: { code: string; unlocked?: boolean }) {
  const Icon = badgeIcons[code as keyof typeof badgeIcons] ?? Award;
  return (
    <span className={'badge-icon ' + (unlocked ? 'unlocked' : '')}>
      <Icon size={21} />
    </span>
  );
}
