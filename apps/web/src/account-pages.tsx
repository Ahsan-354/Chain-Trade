import { useState } from 'react';
import type { FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowLeft,
  ArrowUpRight,
  Award,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Compass,
  Crown,
  Layers3,
  LockKeyhole,
  Medal,
  Pause,
  Play,
  ScrollText,
  ShieldCheck,
  UserRound,
  UsersRound,
  WalletCards,
} from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { Link } from 'react-router-dom';
import { api, fmt, money, qty, symbols, timeText, useApi } from './api';
import type {
  AdminUser,
  Asset,
  Badge,
  Overview,
  Point,
  Portfolio,
  Range,
  Ranking,
  Symbol,
  Trade,
  TradePage,
} from './api';
import {
  AssetIcon,
  AssetLabel,
  BadgeIcon,
  Delta,
  Empty,
  Metric,
  Notice,
  PageTitle,
  Pending,
  RangeTabs,
  Retry,
  Section,
  Status,
  TradesTable,
  ValueChart,
} from './components';
import './account-pages.css';

function Performance() {
  const [range, setRange] = useState<Range>('24H');
  const points = useApi<Point[]>('/portfolio/performance?range=' + range);
  return (
    <section className="panel chart-panel portfolio-performance">
      <Section
        title="Portfolio performance"
        subtitle="Cash and holdings marked to market in CST."
        action={<RangeTabs value={range} change={setRange} />}
      />
      {points.isError ? (
        <Retry error={points.error} onRetry={() => void points.refetch()} />
      ) : points.data ? (
        <ValueChart points={points.data} range={range} />
      ) : (
        <Pending label="Loading portfolio chart…" />
      )}
    </section>
  );
}

const allocationColors = { CST: '#486441', BTCX: '#bd743b', ETHX: '#8260ae', SOLX: '#32847b' };
export function PortfolioPage() {
  const p = useApi<Portfolio>('/portfolio');
  if (p.error) return <Retry error={p.error} onRetry={() => void p.refetch()} />;
  if (!p.data) return <Pending />;
  const { value, pnl, roi, balance, cashAllocation, holdings } = p.data;
  const positions = holdings.filter((h) => Number(h.quantity) > 0);
  const chart = [
    { symbol: 'CST' as const, value: Number(balance), allocation: cashAllocation },
    ...positions.map((h) => ({
      symbol: h.symbol,
      value: Number(h.value),
      allocation: h.allocation,
    })),
  ];
  const fundedSlices = chart.filter((slice) => slice.value > 0);
  return (
    <>
      <PageTitle
        title="Portfolio"
        description="Track your holdings, cost basis, and performance."
        action={
          <Link className="btn primary" to="/markets">
            Browse markets <ArrowUpRight size={16} />
          </Link>
        }
      />
      <div className="portfolio-summary">
        <section className="panel portfolio-worth">
          <div className="portfolio-worth-heading">
            <h2>Portfolio value</h2>
            <span aria-hidden="true">
              <ChartNoAxesCombined size={20} />
            </span>
          </div>
          <p>
            {fmt(value)} <small>CST</small>
          </p>
          <div className="portfolio-worth-caption">Cash and asset holdings</div>
        </section>
        <Metric
          label="Overall profit / loss"
          value={<Delta value={pnl} suffix=" CST" />}
          icon={<Activity size={18} />}
        >
          <Delta value={roi} /> return
        </Metric>
        <Metric label="Available CST" value={money(balance)} icon={<WalletCards size={18} />}>
          Available to trade
        </Metric>
      </div>
      <div className="portfolio-analytics">
        <Performance />
        <section className="panel allocation portfolio-allocation">
          <Section title="Allocation" subtitle="Share of total portfolio value" />
          <div className="allocation-chart">
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <PieChart>
                <Pie
                  data={fundedSlices}
                  dataKey="value"
                  nameKey="symbol"
                  innerRadius="72%"
                  outerRadius="98%"
                  paddingAngle={fundedSlices.length > 1 ? 3 : 0}
                  cornerRadius={fundedSlices.length > 1 ? 4 : 0}
                  stroke="none"
                  isAnimationActive={false}
                >
                  {fundedSlices.map((slice) => (
                    <Cell key={slice.symbol} fill={allocationColors[slice.symbol]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(v) => money(Number(v))}
                  contentStyle={{ borderRadius: 12, border: '1px solid #dfe2d9', fontSize: 12 }}
                />
              </PieChart>
            </ResponsiveContainer>
            <span className="allocation-center" aria-hidden="true">
              <Layers3 size={25} strokeWidth={1.5} />
            </span>
          </div>
          <div className="allocation-legend">
            {chart.map((slice) => (
              <div className="spread" key={slice.symbol}>
                <span>
                  <i aria-hidden="true" style={{ background: allocationColors[slice.symbol] }} />
                  {slice.symbol}
                </span>
                <strong>{fmt(slice.allocation)}%</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="panel table-panel account-table holdings-table">
        <Section
          title="Asset holdings"
          subtitle="Unrealized P/L uses the weighted-average buy price."
        />
        {positions.length ? (
          <div className="table-wrap" role="region" aria-label="Asset holdings" tabIndex={0}>
            <table role="table">
              <thead role="rowgroup">
                <tr role="row">
                  {[
                    'Asset',
                    'Quantity',
                    'Average buy',
                    'Current price',
                    'Holdings value',
                    'Unrealized P/L',
                    'Allocation',
                  ].map((label) => (
                    <th role="columnheader" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody role="rowgroup">
                {positions.map((h) => (
                  <tr role="row" key={h.symbol}>
                    <td role="cell" data-label="Asset">
                      <Link className="asset-link" to={'/markets/' + h.symbol}>
                        <AssetLabel symbol={h.symbol} />
                      </Link>
                    </td>
                    <td role="cell" data-label="Quantity">
                      {qty(h.quantity)}
                    </td>
                    <td role="cell" data-label="Average buy">
                      {money(h.averageBuy)}
                    </td>
                    <td role="cell" data-label="Current price">
                      {money(h.price)}
                    </td>
                    <td role="cell" data-label="Holdings value">
                      {money(h.value)}
                    </td>
                    <td role="cell" data-label="Unrealized P/L">
                      <Delta value={h.unrealized} suffix=" CST" />
                    </td>
                    <td role="cell" data-label="Allocation">
                      {fmt(h.allocation)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No asset positions yet">
            <Link className="text-link" to="/markets">
              Browse markets to place your first order
            </Link>
          </Empty>
        )}
      </section>
    </>
  );
}

export function HistoryPage() {
  const [filters, setFilters] = useState({ symbol: '', side: '', from: '', to: '', hash: '' });
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page) });
  const invalid = Boolean(filters.from && filters.to && filters.from > filters.to);
  const invalidHash = !/^(0x)?[0-9a-f]{0,64}$/i.test(filters.hash);
  Object.entries(filters).forEach(([key, value]) => {
    if (value && !(invalid && key === 'to') && !(invalidHash && key === 'hash'))
      params.set(key, value);
  });
  const trades = useApi<TradePage>('/trades/history?' + params);
  const set = (key: keyof typeof filters, value: string) => {
    setFilters({ ...filters, [key]: value });
    setPage(1);
  };
  return (
    <>
      <PageTitle
        title="Trade history"
        description="Review confirmed orders and their on-chain transaction receipts."
      />
      <section className="panel table-panel account-table history-panel">
        <Section
          title="Transactions"
          subtitle="Date filters use UTC. Select a hash to open its receipt."
          action={
            <span className="account-section-icon" aria-hidden="true">
              <ScrollText size={19} />
            </span>
          }
        />
        <div className="filters history-filters">
          <label className="field">
            Asset
            <select value={filters.symbol} onChange={(e) => set('symbol', e.target.value)}>
              <option value="">All assets</option>
              {symbols.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Type
            <select value={filters.side} onChange={(e) => set('side', e.target.value)}>
              <option value="">All types</option>
              <option value="BUY">Buy</option>
              <option value="SELL">Sell</option>
            </select>
          </label>
          <label className="field">
            From
            <input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} />
          </label>
          <label className="field">
            To
            <input
              type="date"
              value={filters.to}
              aria-invalid={invalid}
              onChange={(e) => set('to', e.target.value)}
            />
          </label>
          <label className="field hash-filter">
            Transaction hash
            <input
              placeholder="Search by hash"
              value={filters.hash}
              aria-invalid={invalidHash}
              onChange={(e) => set('hash', e.target.value.trim())}
            />
          </label>
        </div>
        {invalid || invalidHash ? (
          <Notice>
            {invalid
              ? 'End date must be on or after the start date.'
              : 'Use a hexadecimal transaction hash or part of one.'}
          </Notice>
        ) : trades.error ? (
          <Retry error={trades.error} onRetry={() => void trades.refetch()} />
        ) : trades.data ? (
          <>
            <TradesTable trades={trades.data.rows} />
            <div className="pagination spread">
              <span>
                {trades.data.total}{' '}
                {trades.data.total === 1 ? 'confirmed order' : 'confirmed orders'}
              </span>
              <div>
                <button
                  className="icon-btn"
                  aria-label="Previous page"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  <ChevronLeft size={17} />
                </button>
                <span>
                  Page {page} of {trades.data.pages}
                </span>
                <button
                  className="icon-btn"
                  aria-label="Next page"
                  disabled={page >= trades.data.pages}
                  onClick={() => setPage(page + 1)}
                >
                  <ChevronRight size={17} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <Pending label="Loading transactions…" />
        )}
      </section>
    </>
  );
}

export function Leaderboard() {
  const data = useApi<Ranking[]>('/leaderboard');
  if (data.error) return <Retry error={data.error} onRetry={() => void data.refetch()} />;
  if (!data.data) return <Pending />;
  return (
    <>
      <PageTitle
        title="Leaderboard"
        description="Traders ranked by the current CST value of their portfolios."
      />
      {data.data.length > 0 && (
        <div className="podium-grid">
          {data.data.slice(0, 3).map((row) => (
            <article className={'panel podium podium-' + row.rank} key={row.rank}>
              <div className="spread podium-meta">
                <span className="podium-rank">Rank {row.rank}</span>
                <span className="podium-medal" aria-hidden="true">
                  {row.rank === 1 ? (
                    <Crown size={25} strokeWidth={1.5} />
                  ) : (
                    <Medal size={22} strokeWidth={1.5} />
                  )}
                </span>
              </div>
              <div className="podium-details">
                <h2>
                  {row.name} {row.isYou && <small className="you-tag">You</small>}
                </h2>
                <strong>
                  {fmt(row.value)} <small>CST</small>
                </strong>
                <div className="podium-return">
                  <Delta value={row.roi} /> <small>return</small>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      <section className="panel table-panel account-table rankings-table">
        <Section title="Full rankings" subtitle="Rankings refresh with simulated price updates." />
        {data.data.length ? (
          <div className="table-wrap" role="region" aria-label="Full rankings" tabIndex={0}>
            <table role="table">
              <thead role="rowgroup">
                <tr role="row">
                  {[
                    'Rank',
                    'Trader',
                    'Portfolio value',
                    'ROI',
                    'Completed trades',
                    'Achievements',
                  ].map((label) => (
                    <th role="columnheader" key={label}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody role="rowgroup">
                {data.data.map((r) => (
                  <tr role="row" key={r.rank} className={r.isYou ? 'your-row' : ''}>
                    <td role="cell" data-label="Rank">
                      <span className="table-rank">{r.rank}</span>
                    </td>
                    <td role="cell" data-label="Trader">
                      <strong>{r.name}</strong> {r.isYou && <span className="you-tag">You</span>}
                    </td>
                    <td role="cell" data-label="Portfolio value">
                      {money(r.value)}
                    </td>
                    <td role="cell" data-label="ROI">
                      <Delta value={r.roi} />
                    </td>
                    <td role="cell" data-label="Completed trades">
                      {r.trades}
                    </td>
                    <td role="cell" data-label="Achievements">
                      {r.badges}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No traders to rank yet" />
        )}
      </section>
    </>
  );
}

export function AchievementsPage() {
  const data = useApi<Badge[]>('/achievements/me');
  if (data.error) return <Retry error={data.error} onRetry={() => void data.refetch()} />;
  if (!data.data) return <Pending />;
  return (
    <>
      <PageTitle
        title="Achievements"
        description="Milestones earned through actual trades and portfolio performance."
        action={
          <span className="achievement-count">
            <Award size={18} /> {data.data.filter((b) => b.unlockedAt).length} of {data.data.length}{' '}
            unlocked
          </span>
        }
      />
      <div className="badge-grid collectible-grid">
        {data.data.map((b) => (
          <section
            className={'panel badge-card collectible ' + (b.unlockedAt ? 'collectible-earned' : '')}
            data-collectible={b.code}
            key={b.code}
          >
            <div className="collectible-art">
              <div className="collectible-medallion" aria-hidden="true">
                <BadgeIcon code={b.code} unlocked={Boolean(b.unlockedAt)} />
              </div>
              <span className={'badge-state ' + (b.unlockedAt ? 'earned' : '')}>
                {b.unlockedAt ? <Award size={13} /> : <LockKeyhole size={12} />}
                {b.unlockedAt ? 'Unlocked' : 'Locked'}
              </span>
            </div>
            <div className="collectible-details">
              <h2>{b.title}</h2>
              <p>{b.description}</p>
              <strong>{b.condition}</strong>
              {b.unlockedAt ? (
                <small>Unlocked {timeText(b.unlockedAt)}</small>
              ) : (
                <div className="collectible-progress">
                  <progress aria-label={b.title + ' progress'} max={b.target} value={b.progress} />
                  <small>
                    {fmt(b.progress, 0)} / {fmt(b.target, 0)} {b.code === 'builder' ? 'CST' : ''}
                  </small>
                </div>
              )}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

export function Admin() {
  const client = useQueryClient();
  const overview = useApi<Overview>('/admin/overview');
  const assets = useApi<Asset[]>('/market/assets');
  const users = useApi<AdminUser[]>('/admin/users');
  const trades = useApi<Trade[]>('/admin/trades');
  const [prices, setPrices] = useState<Partial<Record<Symbol, string>>>({});
  const [feedback, setFeedback] = useState('');
  const mutatePrices = useMutation({
    mutationFn: (body: Partial<Record<Symbol, string>>) => api('/admin/prices', body),
    onSuccess: () => {
      setPrices({});
      setFeedback('Market prices updated on-chain.');
      void client.invalidateQueries();
    },
  });
  const market = useMutation({
    mutationFn: (paused: boolean) => api('/admin/market/' + (paused ? 'resume' : 'pause'), {}),
    onSuccess: () => {
      setFeedback('Trading status updated on-chain.');
      void client.invalidateQueries();
    },
  });
  const error = overview.error ?? assets.error ?? users.error ?? trades.error;
  if (error) return <Retry error={error} onRetry={() => void client.invalidateQueries()} />;
  if (!overview.data || !assets.data || !users.data || !trades.data) return <Pending />;
  const stats = overview.data;
  function update(event: FormEvent) {
    event.preventDefault();
    if (mutatePrices.isPending) return;
    setFeedback('');
    market.reset();
    mutatePrices.mutate(
      Object.fromEntries(Object.entries(prices).filter(([, value]) => value.trim())),
    );
  }
  return (
    <>
      <PageTitle
        title="Market administration"
        description="Manage the simulated exchange and monitor platform activity."
        action={<Status paused={stats.paused} />}
      />
      {(mutatePrices.error || market.error) && (
        <Notice>{(mutatePrices.error ?? market.error)?.message}</Notice>
      )}
      {feedback && <Notice tone="success">{feedback}</Notice>}
      <div className="admin-workspace">
        <section className="panel admin-market-controls">
          <div className="admin-control-symbol" aria-hidden="true">
            <ShieldCheck size={24} strokeWidth={1.6} />
          </div>
          <div>
            <Section
              title="Trading controls"
              subtitle="The exchange enforces this setting for every order."
            />
            <div className="admin-market-state">
              <span>Trading status</span>
              <strong>{stats.paused ? 'Paused' : 'Open'}</strong>
            </div>
            <p>Automatic price updates continue while orders are paused.</p>
          </div>
          <button
            className="btn secondary"
            disabled={market.isPending || mutatePrices.isPending}
            onClick={() => {
              setFeedback('');
              mutatePrices.reset();
              market.mutate(stats.paused);
            }}
          >
            {stats.paused ? <Play size={16} /> : <Pause size={16} />}{' '}
            {market.isPending ? 'Updating…' : stats.paused ? 'Resume trading' : 'Pause trading'}
          </button>
        </section>
        <section className="panel admin-price-panel">
          <Section
            title="Manual price update"
            subtitle="Enter new CST prices for the assets you want to change."
          />
          <form onSubmit={update} className="admin-prices">
            {assets.data.map((a) => (
              <label className="field" key={a.symbol}>
                <span className="admin-price-asset">
                  <AssetIcon symbol={a.symbol} /> {a.symbol}
                </span>
                <span className="muted admin-price-current">Current {money(a.price)}</span>
                <input
                  aria-label={a.symbol + ' price'}
                  value={prices[a.symbol] ?? ''}
                  placeholder={qty(a.price)}
                  inputMode="decimal"
                  onChange={(event) => setPrices({ ...prices, [a.symbol]: event.target.value })}
                />
                <small className="muted">
                  Range {fmt(a.min, 0)}–{fmt(a.max, 0)} CST
                </small>
              </label>
            ))}
            <button
              className="btn primary"
              disabled={
                mutatePrices.isPending ||
                market.isPending ||
                !Object.values(prices).some((v) => v.trim())
              }
            >
              {mutatePrices.isPending ? 'Updating…' : 'Update prices'}
              <ArrowUpRight size={16} />
            </button>
          </form>
        </section>
      </div>
      <div className="admin-stats">
        <Metric
          label="CST in circulation"
          value={money(stats.circulation)}
          icon={<CircleDollarSign size={17} />}
        />
        <Metric
          label="Total trade volume"
          value={money(stats.volume)}
          icon={<ChartNoAxesCombined size={17} />}
        />
        <Metric
          label="Trades today · UTC"
          value={stats.tradesToday}
          icon={<Activity size={17} />}
        />
        <Metric label="Total users" value={stats.users} icon={<UsersRound size={17} />} />
        <Metric
          label="Active users · 24h"
          value={stats.activeUsers}
          icon={<UserRound size={17} />}
        />
      </div>
      <section className="panel table-panel account-table">
        <Section title="Recent platform trades" />
        <TradesTable trades={trades.data} />
      </section>
      <section className="panel table-panel account-table admin-user-table">
        <Section title="User accounts" />
        <div className="table-wrap" role="region" aria-label="User accounts" tabIndex={0}>
          <table role="table">
            <thead role="rowgroup">
              <tr role="row">
                {['User', 'Role', 'Wallet', 'CST balance', 'Trades', 'Last active'].map((label) => (
                  <th role="columnheader" key={label}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody role="rowgroup">
              {users.data.map((u) => (
                <tr role="row" key={u.id}>
                  <td role="cell" data-label="User">
                    <strong>{u.name}</strong>
                    <small className="block muted">{u.email}</small>
                  </td>
                  <td role="cell" data-label="Role">
                    <span
                      className={
                        'admin-role ' + (u.role === 'ADMIN' ? 'admin-role-privileged' : '')
                      }
                    >
                      {u.role === 'ADMIN' ? 'Admin' : 'Trader'}
                    </span>
                  </td>
                  <td role="cell" data-label="Wallet">
                    <code>{u.wallet ?? 'Pending'}</code>
                  </td>
                  <td role="cell" data-label="CST balance">
                    {u.balance ? money(u.balance) : '—'}
                  </td>
                  <td role="cell" data-label="Trades">
                    {u.trades}
                  </td>
                  <td role="cell" data-label="Last active">
                    {timeText(u.lastActiveAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

export function Missing() {
  return (
    <section className="panel missing account-missing">
      <div className="missing-art" aria-hidden="true">
        <Compass size={55} strokeWidth={1.1} />
      </div>
      <div className="missing-copy">
        <h1>Page unavailable</h1>
        <p>This address doesn’t match a ChainTrade page.</p>
        <Link className="btn primary" to="/">
          <ArrowLeft size={16} /> Back to dashboard
        </Link>
      </div>
    </section>
  );
}
