import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Award,
  Clock3,
  Layers3,
  Medal,
  WalletCards,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { fmt, timeText, useApi } from './api';
import type { Asset, Badge, Point, Portfolio, Profile, Range, Ranking, TradePage } from './api';
import {
  BadgeIcon,
  Delta,
  Empty,
  MarketCards,
  Notice,
  PageTitle,
  Pending,
  RangeTabs,
  Retry,
  Section,
  TradesTable,
  ValueChart,
} from './components';
import './dashboard.css';

export {
  AchievementsPage,
  Admin,
  HistoryPage,
  Leaderboard,
  Missing,
  PortfolioPage,
} from './account-pages';
export { MarketDetail, Markets } from './markets';

function Performance({ portfolio }: { portfolio: Portfolio }) {
  const [range, setRange] = useState<Range>('24H');
  const points = useApi<Point[]>('/portfolio/performance?range=' + range);
  return (
    <section className="panel dashboard-performance">
      <div className="performance-top">
        <div>
          <h2>Portfolio value</h2>
          <div className="performance-value">
            <strong>{fmt(portfolio.value)}</strong> <small>CST</small>
          </div>
        </div>
        <RangeTabs value={range} change={setRange} />
      </div>
      <div className="performance-meta">
        <span className="performance-return">
          <Delta value={portfolio.roi} />
        </span>
        <span>All-time return</span>
      </div>
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

export function Dashboard({ user }: { user: Profile }) {
  const [welcome] = useState(() => sessionStorage.getItem('chaintrade.starterCredit') === user.id);
  useEffect(() => {
    if (welcome) sessionStorage.removeItem('chaintrade.starterCredit');
  }, [welcome]);
  const portfolio = useApi<Portfolio>('/portfolio');
  const assets = useApi<Asset[]>('/market/assets');
  const recent = useApi<TradePage>('/trades/history');
  const leaderboard = useApi<Ranking[]>('/leaderboard');
  const badges = useApi<Badge[]>('/achievements/me');
  const client = useQueryClient();
  const failure = [portfolio, assets, recent, leaderboard, badges].find((q) => q.error)?.error;
  if (failure) return <Retry error={failure} onRetry={() => void client.invalidateQueries()} />;
  if (!portfolio.data || !assets.data || !recent.data || !leaderboard.data || !badges.data)
    return <Pending />;
  const p = portfolio.data;
  const unlocked = badges.data
    .filter((badge) => badge.unlockedAt)
    .sort((a, b) => Date.parse(b.unlockedAt!) - Date.parse(a.unlockedAt!))
    .slice(0, 3);
  return (
    <div className="dashboard route-page">
      <PageTitle
        title="Portfolio overview"
        description={'Welcome back, ' + user.name.split(' ')[0] + '.'}
        action={
          <Link to="/markets/BTCX" className="btn primary">
            Quick trade <ArrowUpRight size={17} />
          </Link>
        }
      />
      {welcome && (
        <Notice tone="success">
          Your wallet is ready. 10,000 CST was credited to your account.
        </Notice>
      )}
      <div className="dashboard-bento">
        <Performance portfolio={p} />
        <section className="panel dashboard-wallet">
          <div className="wallet-art" aria-hidden="true">
            <div className="wallet-art-back" />
            <div className="wallet-art-front">
              <Layers3 size={32} strokeWidth={1.35} />
            </div>
          </div>
          <div className="wallet-head">
            <WalletCards size={17} />
            <h2>Available balance</h2>
          </div>
          <div className="wallet-amount">
            <strong>{fmt(p.balance)}</strong> <small>CST</small>
          </div>
          <div className="wallet-foot">
            <code>{user.wallet}</code>
            <Link to="/portfolio" aria-label="Open portfolio" className="wallet-arrow">
              <ArrowUpRight size={18} />
            </Link>
          </div>
        </section>
        <section className="panel dashboard-pnl">
          <Activity size={17} />
          <h2>Total profit / loss</h2>
          <strong>
            <Delta value={p.pnl} suffix="" /> <small>CST</small>
          </strong>
          <small>Since inception</small>
        </section>
        <section className="panel dashboard-pnl dashboard-today">
          <Clock3 size={17} />
          <h2>Today’s gain / loss</h2>
          <strong>
            <Delta value={p.today} suffix="" /> <small>CST</small>
          </strong>
          <small>
            <Delta value={p.todayPercent} /> since 00:00 UTC
          </small>
        </section>
      </div>
      <section className="page-section dashboard-markets">
        <Section
          title="Market watch"
          action={
            <Link className="text-link" to="/markets">
              All markets <ArrowRight size={15} />
            </Link>
          }
        />
        <MarketCards assets={assets.data} />
      </section>
      <div className="dashboard-activity">
        <section className="panel table-panel dashboard-trades">
          <Section
            title="Recent trades"
            action={
              <Link className="text-link" to="/history">
                View history <ArrowRight size={15} />
              </Link>
            }
          />
          <TradesTable compact trades={recent.data.rows.slice(0, 4)} />
        </section>
        <section className="panel board-preview">
          <Section title="Leaderboard" action={<Medal size={20} className="muted" />} />
          {leaderboard.data.length === 0 ? (
            <Empty title="No traders yet" />
          ) : (
            <div className="preview-rows">
              {leaderboard.data.slice(0, 4).map((row) => (
                <div className="preview-row" key={row.rank}>
                  <span className={'rank-chip rank-' + row.rank}>
                    {String(row.rank).padStart(2, '0')}
                  </span>
                  <span>
                    <strong>{row.name}</strong>
                    <small>{row.trades} trades</small>
                  </span>
                  <span>
                    <strong>{fmt(row.value)}</strong>
                    <small>
                      <Delta value={row.roi} />
                    </small>
                  </span>
                </div>
              ))}
            </div>
          )}
          <Link className="text-link panel-link" to="/leaderboard">
            View leaderboard <ArrowRight size={15} />
          </Link>
        </section>
        <section className="panel dashboard-badges">
          <Section title="Recent achievements" action={<Award size={19} />} />
          {unlocked.length ? (
            <div className="dashboard-badge-list">
              {unlocked.map((b) => (
                <div className="mini-badge" key={b.code}>
                  <BadgeIcon code={b.code} unlocked />
                  <div>
                    <strong>{b.title}</strong>
                    <small>{timeText(b.unlockedAt!)}</small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="Your first badge awaits">Complete a trade to unlock First Trade.</Empty>
          )}
          <Link className="text-link panel-link" to="/achievements">
            View achievements <ArrowRight size={15} />
          </Link>
        </section>
      </div>
    </div>
  );
}
