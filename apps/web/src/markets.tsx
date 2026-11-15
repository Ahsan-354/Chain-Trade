import { useState } from 'react';
import { ArrowLeft, ArrowUpRight, ScanLine, Search } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { fmt, money, symbols, useApi } from './api';
import type { Asset, Point, Range, Symbol } from './api';
import { Missing } from './account-pages';
import {
  AssetIcon,
  AssetLabel,
  Delta,
  Empty,
  MarketCards,
  PageTitle,
  Pending,
  RangeTabs,
  Retry,
  Section,
  Sparkline,
  ValueChart,
} from './components';
import { TradePanel } from './trade';
import './markets.css';

export function Markets() {
  const assets = useApi<Asset[]>('/market/assets');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Symbol | 'All'>('All');
  if (assets.error) return <Retry error={assets.error} onRetry={() => void assets.refetch()} />;
  if (!assets.data) return <Pending />;
  const rows = assets.data.filter(
    (a) =>
      (filter === 'All' || a.symbol === filter) &&
      (a.symbol + ' ' + a.name).toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <>
      <PageTitle
        title="Markets"
        description="Explore simulated prices and trade synthetic assets in CST."
      />
      <div className="market-discovery">
        <MarketCards assets={assets.data} />
      </div>
      <section className="panel table-panel market-directory">
        <Section title="All assets" />
        <div className="filters market-filters">
          <div className="segmented" aria-label="Asset filter">
            {(['All', ...symbols] as const).map((value) => (
              <button key={value} aria-pressed={value === filter} onClick={() => setFilter(value)}>
                {value === 'All' ? 'All assets' : value}
              </button>
            ))}
          </div>
          <label className="search">
            <Search size={17} />
            <input
              aria-label="Search markets"
              placeholder="Search assets"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table className="market-data" role="table">
              <thead role="rowgroup">
                <tr role="row">
                  <th scope="col" role="columnheader">
                    Asset
                  </th>
                  <th scope="col" role="columnheader">
                    Price
                  </th>
                  <th scope="col" role="columnheader">
                    24h change
                  </th>
                  <th scope="col" role="columnheader">
                    Last 24 hours
                  </th>
                  <th scope="col" role="columnheader">
                    Order
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {rows.map((asset) => (
                  <tr key={asset.symbol} role="row">
                    <td className="market-data-asset" role="cell">
                      <Link className="asset-link" to={'/markets/' + asset.symbol}>
                        <AssetLabel symbol={asset.symbol} name={asset.name} />
                      </Link>
                    </td>
                    <td className="market-data-price" role="cell">
                      <strong>{fmt(asset.price)}</strong> <small>CST</small>
                    </td>
                    <td className="market-data-change" role="cell">
                      <Delta value={asset.change} />
                      <small className="market-mobile-range" aria-hidden="true">
                        24h
                      </small>
                    </td>
                    <td className="market-data-chart" role="cell">
                      <Sparkline points={asset.sparkline} negative={(asset.change ?? 0) < 0} />
                    </td>
                    <td className="market-data-order" role="cell">
                      <Link
                        className="btn secondary small"
                        to={'/markets/' + asset.symbol + '#trade'}
                      >
                        Trade <ArrowUpRight size={14} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="No matching assets">Change the search or select another filter.</Empty>
        )}
      </section>
    </>
  );
}

export function MarketDetail() {
  const { symbol } = useParams();
  const assets = useApi<Asset[]>('/market/assets');
  if (assets.error) return <Retry error={assets.error} onRetry={() => void assets.refetch()} />;
  if (!assets.data) return <Pending />;
  const asset = assets.data.find((a) => a.symbol === symbol);
  if (!asset) return <Missing />;
  return <MarketDetailContent key={asset.symbol} asset={asset} />;
}

function MarketDetailContent({ asset }: { asset: Asset }) {
  const [range, setRange] = useState<Range>('24H');
  const points = useApi<Point[]>('/market/assets/' + asset.symbol + '/history?range=' + range);
  return (
    <div className="market-detail">
      <Link className="text-link market-back" to="/markets">
        <ArrowLeft size={16} /> Back to markets
      </Link>
      <header className="market-detail-heading page-title" data-asset={asset.symbol}>
        <AssetIcon symbol={asset.symbol} />
        <div>
          <div className="market-pair">{asset.symbol} / CST</div>
          <h1>{asset.name}</h1>
          <p>{asset.description}</p>
        </div>
      </header>
      <div className="trade-grid">
        <div className="market-analysis">
          <section className="panel chart-panel market-chart">
            <Section title="Price history" action={<RangeTabs value={range} change={setRange} />} />
            <div className="price-hero">
              <strong>
                {fmt(asset.price)} <small>CST</small>
              </strong>
              <span className="price-move">
                <Delta value={asset.change} /> <small>24h change</small>
              </span>
            </div>
            <div className="market-chart-body">
              {points.error ? (
                <Retry error={points.error} onRetry={() => void points.refetch()} />
              ) : points.data ? (
                <ValueChart points={points.data} range={range} />
              ) : (
                <Pending label="Loading price history…" />
              )}
            </div>
          </section>
          <section className="panel market-bounds">
            <span className="market-bounds-icon" aria-hidden="true">
              <ScanLine size={22} />
            </span>
            <div>
              <h2>Simulated price limits</h2>
              <p>Configured for {asset.symbol}</p>
            </div>
            <dl>
              <div>
                <dt>Minimum</dt>
                <dd>{money(asset.min)}</dd>
              </div>
              <div>
                <dt>Maximum</dt>
                <dd>{money(asset.max)}</dd>
              </div>
            </dl>
          </section>
        </div>
        <div id="trade" className="market-order">
          <TradePanel initial={asset.symbol} />
        </div>
      </div>
    </div>
  );
}
