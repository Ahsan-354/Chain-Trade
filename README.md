# ChainTrade

ChainTrade is a learning project that lets you practice cryptocurrency trading in a simulated exchange. You receive play-money called CST, choose a simulated asset, and place buy or sell orders. The app records each completed order and updates your account and portfolio.

Nothing here connects to a real exchange or moves real money. Prices are generated locally, accounts and wallets are managed by the demo server, and the blockchain runs on your own computer. You do not need cryptocurrency or a browser wallet to try it.

## How the simulation works

Think of the app as a small exchange with a visible, tamper-resistant receipt book. The React website sends an order to the Express API. The API checks your account and simulated balance, then asks a Solidity smart contract on a local Ethereum-compatible blockchain to settle the trade. After the local blockchain confirms it, the API saves the receipt and portfolio details in PostgreSQL. The price engine moves demo prices periodically; it does not fetch live market prices.

Ethereum-compatible means this local blockchain uses the same contract and transaction conventions as Ethereum. Hardhat runs a private development network on your computer, so students can inspect contracts and transactions without paying network fees. It is not connected to Ethereum mainnet.

Bitcoin itself does not run on Ethereum. ChainTrade represents it with BTCX, a synthetic ERC-20 token created only for this simulation. BTCX is a demo unit whose price is managed by ChainTrade; it is not Bitcoin, cannot be redeemed for Bitcoin, and has no claim on real BTC. ETHX and SOLX are simulated assets in the same way. CST is the virtual currency used to buy and sell them.

## What each technology does

- **React and Vite** provide the browser interface and local development server.
- **Express and TypeScript** implement account, market, portfolio, and trading APIs.
- **PostgreSQL and Prisma** store accounts, encrypted demo wallet keys, trade history, and indexed chain events.
- **Solidity and OpenZeppelin ERC-20** implement CST and the simulated assets, while the exchange contract checks and settles orders.
- **Hardhat** compiles and tests the contracts and runs the local Ethereum-compatible network.
- **Node.js and npm workspaces** install and run the API, website, and contracts from one repository.

## Requirements

- Node.js 22 or newer and npm
- Docker Engine or Docker Desktop with the Compose plugin
- Free local ports 5432 (PostgreSQL), 8545 (Hardhat), 4000 (API), and 5173 (web)
- Chromium for the optional full-browser test

## Local setup

Clone the repository, then run these commands from its root directory:

```bash
git clone https://github.com/Ahsan-354/Chain-Trade.git
cd Chain-Trade
npm ci
npm run setup
docker compose up -d --wait postgres
npm run db:generate
npm run db:migrate
```

`npm run setup` creates `.env` from `.env.example` and generates a JWT signing secret and a 32-byte AES key. Keep the AES key with the database it was created for. If PostgreSQL already runs locally, you can create a fresh `chaintrade` database and set `DATABASE_URL` to its connection string, then run the same Prisma commands.

In a second terminal, start Hardhat and leave it running.

```bash
npm run chain
```

When Hardhat is listening, return to the first terminal.

```bash
npm run deploy
npm run seed
npm run dev
```

| Service            | Local URL                        |
| ------------------ | -------------------------------- |
| React dashboard    | http://localhost:5173            |
| Express API health | http://127.0.0.1:4000/api/health |
| Hardhat JSON-RPC   | http://127.0.0.1:8545            |
| PostgreSQL         | 127.0.0.1:5432                   |

Use `localhost` for the web UI as shown above. The development proxy forwards `/api` to Express and streams market events over the same origin. If you change the frontend origin, update `WEB_ORIGIN`. Use `npm run dev:api` and `npm run dev:web` to launch the services in separate terminals.

## Demo accounts

| Account       | Email                       | Password            |
| ------------- | --------------------------- | ------------------- |
| Administrator | admin@chaintrade.local      | ChainTradeDemo!2026 |
| Seeded trader | maya.patel@chaintrade.local | PracticeTrade!2026  |

These credentials are for this local demonstration. Set `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, and `SEED_TRADER_PASSWORD` before the first seed to use different values. The seed creates 12 traders, authentic on-chain buy/sell transactions, a ranked leaderboard, badge definitions, and simulated market snapshots covering the period before deployment. Seeded chart history before deployment is generated data. Seeded trades are mined on Hardhat and keep their actual block timestamps. Re-running a completed seed is safe. Run the seed with the API stopped.

## Demo walkthrough

1. Register a trader with an unused email. The dashboard shows the 10,000 CST credit and a masked wallet address.
2. Open **Markets** and select BTCX, ETHX, or SOLX. Enter an asset quantity or CST amount, review the quote, and confirm. The receipt displays the transaction hash and updated CST balance.
3. Sell some units from the same market. Open **Portfolio** for current positions and **Trade History** for filters and receipt details.
4. Open **Achievements** to see First Trade. Trade all three assets to unlock Explorer. The leaderboard includes the signed-in trader wherever they rank.
5. Sign in as the seeded administrator. Change an asset price and review its chart. Pause trading, verify that the order ticket is disabled, and resume trading.

## How trades settle

1. Registration creates a random EVM wallet. The API encrypts its private key with AES-256-GCM, a random IV, and the wallet address as authenticated data. PostgreSQL stores the encrypted payload and a bcrypt password hash. The Hardhat deployer funds local gas and grants the one-time 10,000 CST reward.
2. The React ticket converts the entered amount using 18-decimal integer arithmetic. Express validates the quote, session, available balance, and idempotency key.
3. The API decrypts the managed signing key, approves the amount to be spent, and calls the exchange. Solidity checks the quoted price, trading status, balances, liquidity, and order ID before transferring ERC-20 tokens. Fixed-point settlement rounds down to the smallest CST unit.
4. The backend indexes `TradeExecuted` from the mined block. It stores the transaction hash, block, execution time, quantity, price, and CST total in PostgreSQL. A persisted block cursor advances in the same transaction as indexed records. Retrying the same confirmation can recover an already-mined receipt without executing it twice.
5. React refreshes the receipt, balance, holdings, performance, history, ranking, and achievements. The price engine moves each asset within ±3% per 30-second tick, subject to asset-specific bounds. Price events supply snapshots and SSE notifies the dashboard. Admin pause blocks trades at the contract while prices continue to move.

## Features and accounting

- Account creation, sign-in, revocable httpOnly JWT sessions, role checks, Zod validation, and rate limiting.
- CST, BTCX, ETHX, and SOLX ERC-20 contracts, exact buy/sell settlement, receipt and order deduplication, and admin price and pause controls.
- Dashboard with market watch, portfolio chart, daily and total P/L, recent trades, ranks, and badges. Market search, filters, and 1H, 24H, 7D, and all-time charts.
- Portfolio allocation, weighted-average cost, and realized price movement reflected in cash. Total P/L is current cash and holdings minus 10,000 CST. Unrealized P/L is marked position value minus remaining cost basis. The trading day begins at 00:00 UTC.
- Transaction history with asset, side, UTC dates, and hash filters, pagination, and receipt details. Ranking by live portfolio value with creation time as the first tie-breaker. Administrative accounts are excluded from trader rankings.
- First Trade, Explorer, Momentum, Profitable Day, Top Ten Trader, and Portfolio Builder. Badge unlocks persist after subsequent price or rank changes.
- Administration with total users, active users over 24 hours, CST outside the exchange reserve, trading volume, trades today, wallet summaries, and recent transactions.

## Testing and building

With PostgreSQL migrated, Hardhat running, and the demo seed complete, run the tests from the root. Stop the API while running backend tests so the automatic market tick cannot race tests that use fixed quotes. The API integration suite creates accounts and orders on the local services. Use a disposable demo instance for testing.

```bash
npm test
npm run lint
npm run build
```

For the browser checks, start the app with `npm run dev` and run the following from another terminal. The browser suite includes a wait of up to 42 seconds for an automatic market tick.

```bash
npx playwright install chromium
npm run test:web
```

On a Linux machine with an existing Chromium, you can use `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:web`. Browser tests use the seeded administrator and register a new trader.

The production build writes the static web app to `apps/web/dist` and the compiled API to `apps/api/dist`. For local compiled serving, run `npm run start -w @chaintrade/api` and serve the web build with an SPA fallback and an `/api` reverse proxy. The Vite development command configures that proxy automatically.

## Limitations

ChainTrade is an educational prototype, not a secure exchange or custody service. Its local Hardhat chain is temporary and resets when stopped; its development accounts and keys are not suitable for real funds. BTCX, ETHX, SOLX, and CST have no real-world backing or redemption value. Prices, chart history, seeded users, and trades are simulated. The API manages demo wallet keys, so this design does not provide the security guarantees of a production wallet. Keep the service bound to your own machine and do not expose it to the public internet.

## Restarting and resetting the demo

You can restart the web and API while keeping the same Hardhat node running. Hardhat Network is in memory. Stopping it loses the local chain, including wallet balances and trades. Keep the deployment manifest, database, and chain together while you work. The API checks the deployment identity so it cannot silently reuse PostgreSQL records with a different chain.

To start over and intentionally discard all local ChainTrade data, stop the app and Hardhat, run `docker compose down -v`, and delete `packages/contracts/deployment.json`. Start PostgreSQL again, apply the migration, then start Hardhat, deploy, seed, and start the app. If you used native PostgreSQL, replace the Docker volume step with recreating the dedicated database. Keep the RPC endpoint bound to loopback. Hardhat's development accounts are publicly known and are only suitable for this local prototype.
