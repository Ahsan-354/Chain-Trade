import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowDownLeft, ArrowRight, ArrowUpRight, LoaderCircle, WalletCards } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { api, money, qty, useApi } from './api';
import type { Asset, MarketState, Portfolio, Receipt, Side, Symbol } from './api';
import { AssetLabel, Modal, Notice, Pending, Retry, Section, TradeDetails } from './components';

const unit = 10n ** 18n;
function parseAmount(value: string) {
  if (!/^\d{1,12}(\.\d{0,18})?$/.test(value)) return 0n;
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * unit + BigInt(fraction.padEnd(18, '0'));
}
function formatAmount(value: bigint) {
  return qty(String(value / unit) + '.' + String(value % unit).padStart(18, '0'));
}

type Order = {
  symbol: Symbol;
  quantity: string;
  expectedPrice: string;
  requestId: string;
  total: string;
  side: Side;
};

export function TradePanel({ initial }: { initial: Symbol }) {
  const client = useQueryClient();
  const { hash } = useLocation();
  const ticket = useRef<HTMLElement>(null);
  const assets = useApi<Asset[]>('/market/assets');
  const portfolio = useApi<Portfolio>('/portfolio');
  const state = useApi<MarketState>('/market/summary');
  const [symbol, setSymbol] = useState(initial);
  const [side, setSide] = useState<Side>('BUY');
  const [input, setInput] = useState<{ by: 'quantity' | 'cst'; raw: string }>({
    by: 'quantity',
    raw: '',
  });
  const [order, setOrder] = useState<Order>();
  const [receipt, setReceipt] = useState<Receipt>();
  const [reviewed, setReviewed] = useState(false);

  const mutation = useMutation({
    mutationFn: ({ side, symbol, quantity, expectedPrice, requestId }: Order) =>
      api<Receipt>('/trades/' + side.toLowerCase(), { symbol, quantity, expectedPrice, requestId }),
    onSuccess: (result) => {
      setReceipt(result);
      setOrder(undefined);
      setInput({ by: 'quantity', raw: '' });
      setReviewed(false);
      void client.invalidateQueries();
    },
    onError: () => {
      void client.invalidateQueries();
    },
  });
  const error = assets.error ?? portfolio.error ?? state.error;
  const asset = assets.data?.find((a) => a.symbol === symbol);
  const ready = Boolean(asset && portfolio.data && state.data && !error);
  useEffect(() => {
    if (hash === '#trade' && ready) ticket.current?.scrollIntoView({ block: 'start' });
  }, [hash, ready]);

  if (error)
    return (
      <div className="panel">
        <Retry
          error={error}
          onRetry={() => {
            void client.invalidateQueries();
          }}
        />
      </div>
    );
  if (!asset || !portfolio.data || !state.data)
    return (
      <div className="panel">
        <Pending label="Loading order ticket…" />
      </div>
    );
  const price = parseAmount(asset.price);
  const rawAmount = parseAmount(input.raw);
  const quantity = input.by === 'quantity' ? rawAmount : (rawAmount * unit) / price;
  const total = (quantity * price) / unit;
  const available =
    side === 'BUY'
      ? portfolio.data.balance
      : (portfolio.data.holdings.find((h) => h.symbol === symbol)?.quantity ?? '0');
  const valid = quantity > 0n && total > 0n;
  const invalid = !valid
    ? 'Enter a positive amount with up to 18 decimal places.'
    : (side === 'BUY' ? total : quantity) > parseAmount(available)
      ? 'Order exceeds your available balance.'
      : '';
  const shownError = (input.raw !== '' || reviewed) && invalid;
  function closeOrder() {
    setOrder(undefined);
    mutation.reset();
  }
  function setMax() {
    setInput({ by: side === 'BUY' ? 'cst' : 'quantity', raw: qty(available) });
  }

  return (
    <section className="panel order-panel" data-side={side.toLowerCase()} ref={ticket}>
      <Section title="Order ticket" subtitle="Trades settle on local Ethereum." />
      <div className="order-tabs" aria-label="Order side">
        <button
          type="button"
          aria-pressed={side === 'BUY'}
          onClick={() => {
            setSide('BUY');
            setReviewed(false);
          }}
        >
          <ArrowDownLeft size={15} aria-hidden="true" /> Buy
        </button>
        <button
          type="button"
          aria-pressed={side === 'SELL'}
          onClick={() => {
            setSide('SELL');
            setReviewed(false);
          }}
        >
          <ArrowUpRight size={15} aria-hidden="true" /> Sell
        </button>
      </div>
      {state.data.paused && (
        <Notice tone="info">
          Trading is paused. You can review prices while the market is paused.
        </Notice>
      )}
      <form
        className="order-form"
        onSubmit={(event) => {
          event.preventDefault();
          setReviewed(true);
          if (invalid || state.data.paused) return;
          mutation.reset();
          setOrder({
            symbol,
            side,
            quantity: formatAmount(quantity),
            total: formatAmount(total),
            expectedPrice: asset.price,
            requestId: crypto.randomUUID(),
          });
        }}
      >
        <label className="field">
          Asset
          <select value={symbol} onChange={(event) => setSymbol(event.target.value as Symbol)}>
            {assets.data?.map((a) => (
              <option key={a.symbol} value={a.symbol}>
                {a.name} ({a.symbol})
              </option>
            ))}
          </select>
        </label>
        <div className="spread order-available">
          <span className="order-wallet">
            <WalletCards size={15} aria-hidden="true" />
            <span>
              Available{' '}
              <strong>{side === 'BUY' ? money(available) : qty(available) + ' ' + symbol}</strong>
            </span>
          </span>
          <button type="button" className="text-link" onClick={setMax}>
            Max
          </button>
        </div>
        <label className="field">
          Quantity
          <span className="input-unit">
            <input
              inputMode="decimal"
              value={input.by === 'quantity' ? input.raw : input.raw ? formatAmount(quantity) : ''}
              onChange={(event) => setInput({ by: 'quantity', raw: event.target.value })}
              aria-invalid={Boolean(shownError)}
              placeholder="0.00"
            />
            <span>{symbol}</span>
          </span>
        </label>
        <label className="field">
          CST amount
          <span className="input-unit">
            <input
              inputMode="decimal"
              value={input.by === 'cst' ? input.raw : input.raw ? formatAmount(total) : ''}
              onChange={(event) => setInput({ by: 'cst', raw: event.target.value })}
              aria-invalid={Boolean(shownError)}
              placeholder="0.00"
            />
            <span>CST</span>
          </span>
        </label>
        {shownError && (
          <small className="field-error" role="alert">
            {shownError}
          </small>
        )}
        <dl className="details order-summary">
          <div>
            <dt>Current price</dt>
            <dd>{money(asset.price)}</dd>
          </div>
          <div>
            <dt>Fee</dt>
            <dd>0.00 CST</dd>
          </div>
          <div className="order-total">
            <dt>Estimated total</dt>
            <dd>{money(formatAmount(total))}</dd>
          </div>
        </dl>
        <button
          className="btn primary full-width order-submit"
          disabled={state.data.paused || mutation.isPending}
        >
          Review {side.toLowerCase()} <ArrowRight size={16} />
        </button>
      </form>
      {order && (
        <Modal title="Confirm trade" close={closeOrder} busy={mutation.isPending}>
          <div className="trade-review" data-side={order.side.toLowerCase()}>
            <div className="order-confirm">
              <AssetLabel symbol={order.symbol} />
              <strong>{order.side === 'BUY' ? 'Buy' : 'Sell'} order</strong>
            </div>
            <dl className="details">
              <div>
                <dt>Quantity</dt>
                <dd>
                  {order.quantity} {order.symbol}
                </dd>
              </div>
              <div>
                <dt>Quoted price</dt>
                <dd>{money(order.expectedPrice)}</dd>
              </div>
              <div>
                <dt>Fee</dt>
                <dd>0.00 CST</dd>
              </div>
              <div className="order-total">
                <dt>{order.side === 'BUY' ? 'You pay' : 'You receive'}</dt>
                <dd>{money(order.total)}</dd>
              </div>
            </dl>
            {mutation.error && <Notice>{mutation.error.message}</Notice>}
            <div className="modal-actions">
              <button className="btn secondary" disabled={mutation.isPending} onClick={closeOrder}>
                {mutation.error ? 'Back to ticket' : 'Cancel'}
              </button>
              <button
                className="btn primary"
                disabled={mutation.isPending}
                onClick={() => {
                  if (!mutation.isPending) mutation.mutate(order);
                }}
              >
                {mutation.isPending ? (
                  <>
                    <LoaderCircle size={17} className="animate-spin" /> Confirming on-chain…
                  </>
                ) : mutation.error ? (
                  'Retry same order'
                ) : (
                  'Confirm ' + order.side.toLowerCase()
                )}
              </button>
            </div>
            {mutation.error && (
              <Link className="text-link" to="/history">
                Check trade history
              </Link>
            )}
          </div>
        </Modal>
      )}
      {receipt && (
        <Modal title="Trade confirmed" close={() => setReceipt(undefined)}>
          <div className="trade-receipt">
            <Notice tone="success">Your transaction settled on the local blockchain.</Notice>
            <TradeDetails trade={receipt.trade} />
            <div className="receipt-balance spread">
              <span>
                <WalletCards aria-hidden="true" size={16} /> Updated CST balance
              </span>
              <strong>{money(receipt.balance)}</strong>
            </div>
            <div className="modal-actions">
              <Link className="btn secondary" to="/history">
                Trade history
              </Link>
              <button className="btn primary" onClick={() => setReceipt(undefined)}>
                Done
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
