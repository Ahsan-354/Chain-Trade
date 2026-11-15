const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { parse } = require('dotenv');

const env = parse(readFileSync(resolve(__dirname, '../../../.env')));
const base = process.env.CHAINTRADE_WEB_URL || env.WEB_ORIGIN;
const screenshotPath = process.env.CHAINTRADE_TEST_SCREENSHOT;
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

async function login(page, email, password) {
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function readApi(page, path) {
  const result = await page.request.get(base + '/api' + path);
  assert.equal(result.status(), 200);
  return (await result.json()).data;
}

async function trade(page, symbol, side, amount) {
  await page.goto(base + '/markets/' + symbol);
  if (side === 'sell') await page.getByRole('button', { name: 'Sell', exact: true }).click();
  await page.getByLabel(/^Quantity/).fill(amount);
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByRole('button', { name: 'Review ' + side }).click();
    const modal = page.getByRole('dialog');
    await modal.getByRole('button', { name: 'Confirm ' + side }).click();
    await Promise.race([
      page.getByRole('heading', { name: 'Trade confirmed' }).waitFor(),
      modal.getByRole('alert').waitFor(),
    ]);
    if (await page.getByRole('heading', { name: 'Trade confirmed' }).isVisible()) {
      const hash = await modal.locator('code').textContent();
      assert.match(hash, /^0x[a-f0-9]{64}$/);
      await modal.getByRole('button', { name: 'Done' }).click();
      return hash;
    }
    const error = await modal.getByRole('alert').textContent();
    assert.match(error, /quote changed/i);
    await modal.getByRole('button', { name: 'Back to ticket' }).click();
  }
  throw new Error('Could not confirm the order within three quote windows.');
}

async function main() {
  const launch = () =>
    chromium.launch({
      executablePath,
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
  const browser = await launch();
  let adminBrowser;
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base + '/portfolio');
    await page.waitForURL('**/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByText('Enter a valid email address.').waitFor();
    await login(page, 'missing@chaintrade.local', 'a-wrong-password');
    await page.getByRole('alert').getByText('Email or password is incorrect.').waitFor();
    await page.getByRole('link', { name: 'Create an account' }).click();
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByText('Enter your full name.').waitFor();
    await page.getByLabel('Full name').fill('Sam Rivera');
    await page.getByLabel('Email address').fill('browser-' + randomUUID() + '@chaintrade.local');
    const password = 'BrowserDemo!2026';
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByLabel('Confirm password').fill('mismatch');
    await page.getByRole('button', { name: 'Create account' }).click();
    await page.getByText('Passwords must match.').waitFor();
    await page.getByLabel('Confirm password').fill(password);
    await page.getByRole('button', { name: 'Create account' }).click();
    await page
      .getByText('Your wallet is ready. 10,000 CST was credited to your account.')
      .waitFor();
    const profile = await readApi(page, '/auth/me');
    assert.equal(profile.balance, '10000.0');
    assert.match(profile.wallet, /^0x[a-f0-9]{4}…[a-f0-9]{4}$/i);
    await page.reload();
    await page.getByRole('heading', { name: 'Portfolio overview' }).waitFor();
    await page.goto(base + '/admin');
    await page.waitForURL(base + '/');
    assert.equal(await page.getByRole('link', { name: 'Admin', exact: true }).count(), 0);
    console.log(
      'PASS login and registration validation, wallet funding, session persistence and route guards',
    );

    await page.goto(base + '/markets');
    await page.getByRole('button', { name: 'ETHX', exact: true }).click();
    await page.getByLabel('Search markets').fill('does not exist');
    await page.getByText('No matching assets').waitFor();
    const firstHash = await trade(page, 'BTCX', 'buy', '0.01');
    await trade(page, 'ETHX', 'buy', '0.2');
    await trade(page, 'SOLX', 'buy', '2');
    const sellHash = await trade(page, 'SOLX', 'sell', '1');
    const p = await readApi(page, '/portfolio');
    assert.equal(p.holdings.find((h) => h.symbol === 'BTCX').quantity, '0.01');
    assert.equal(p.holdings.find((h) => h.symbol === 'ETHX').quantity, '0.2');
    assert.equal(p.holdings.find((h) => h.symbol === 'SOLX').quantity, '1.0');
    assert.ok(Number(p.balance) < 10000);
    await page.goto(base + '/');
    await page.getByRole('heading', { name: 'Recent trades' }).waitFor();
    await page.getByRole('button', { name: 'View transaction ' + sellHash }).waitFor();
    if (screenshotPath) await page.screenshot({ path: screenshotPath, fullPage: true });
    await page.goto(base + '/portfolio');
    await page.getByRole('heading', { name: 'Asset holdings' }).waitFor();
    await page.getByRole('row').filter({ hasText: 'SOLX' }).waitFor();
    await page.goto(base + '/history');
    await page.getByLabel('Type').selectOption('BUY');
    await page.getByLabel('Transaction hash').fill(firstHash);
    await page.getByRole('button', { name: 'View transaction ' + firstHash }).click();
    await page.getByRole('heading', { name: 'Transaction details' }).waitFor();
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    await page.goto(base + '/achievements');
    await page
      .locator('.badge-card')
      .filter({ hasText: 'Explorer' })
      .getByText('Unlocked', { exact: true })
      .waitFor();
    await page.goto(base + '/leaderboard');
    await page
      .getByRole('row')
      .filter({ hasText: 'Sam Rivera' })
      .getByText('You', { exact: true })
      .waitFor();
    console.log(
      'PASS three-asset buys, sell, receipts, refreshed holdings and dashboard, history, rankings and achievement unlocks',
    );

    await page.goto(base + '/markets/BTCX');
    await page.getByRole('button', { name: '7D', exact: true }).click();
    await page.locator('.recharts-area').waitFor({ state: 'attached' });
    const initial = (await readApi(page, '/market/summary')).updatedAt;
    const received = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const feed = new EventSource('/api/market/stream');
          const timer = setTimeout(() => {
            feed.close();
            resolve(false);
          }, 42_000);
          feed.addEventListener(
            'market',
            () => {
              clearTimeout(timer);
              feed.close();
              resolve(true);
            },
            { once: true },
          );
        }),
    );
    assert.ok(received, 'The browser should receive an automatic market event');
    assert.notEqual((await readApi(page, '/market/summary')).updatedAt, initial);
    const candles = await readApi(page, '/market/assets/BTCX/history?range=7D');
    assert.ok(candles.length > 10);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
    await page.getByRole('heading', { name: 'Portfolio overview' }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    await page.goto(base + '/wrong-path');
    await page.getByRole('heading', { name: 'Page unavailable' }).waitFor();
    if (screenshotPath)
      await page.goto(base + '/').then(async () => {
        await page.getByRole('heading', { name: 'Portfolio overview' }).waitFor();
        await page.screenshot({
          path: screenshotPath.replace('.png', '-mobile.png'),
          fullPage: true,
        });
      });
    assert.deepEqual(errors, []);
    console.log(
      'PASS automatic market updates, chart time ranges, mobile layout and navigation, and 404 page',
    );

    adminBrowser = await launch();
    const admin = await adminBrowser.newPage({ viewport: { width: 1440, height: 960 } });
    admin.setDefaultTimeout(12000);
    await admin.goto(base + '/login');
    await login(admin, env.SEED_ADMIN_EMAIL, env.SEED_ADMIN_PASSWORD);
    await admin.getByRole('link', { name: 'Admin', exact: true }).click();
    await admin.getByLabel('BTCX price').fill('69501.125');
    await admin.getByRole('button', { name: 'Update prices' }).click();
    await admin.getByText('Market prices updated on-chain.').waitFor();
    const prices = await readApi(admin, '/market/assets');
    assert.equal(prices.find((asset) => asset.symbol === 'BTCX').price, '69501.125');
    await admin.getByRole('button', { name: 'Pause trading' }).click();
    await admin.getByRole('button', { name: 'Resume trading' }).waitFor();
    await page.goto(base + '/markets/SOLX');
    const disabled = page.getByRole('button', { name: 'Review buy' });
    await disabled.waitFor();
    assert.equal(await disabled.isDisabled(), true);
    await admin.getByRole('button', { name: 'Resume trading' }).click();
    await admin.getByRole('button', { name: 'Pause trading' }).waitFor();
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await page.waitForURL('**/login');
    console.log(
      'PASS administrator price updates, pause and resume, trader pause state and sign-out',
    );
  } finally {
    await adminBrowser?.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
