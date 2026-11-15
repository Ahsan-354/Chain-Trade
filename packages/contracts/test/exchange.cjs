const { expect } = require('chai');
const { ethers } = require('hardhat');

const u = ethers.parseEther;
const ref = ethers.id;

describe('ChainTrade contracts', function () {
  let admin, user, outsider, cst, btc, exchange, market, btcAddress;
  const price = u('68420');

  beforeEach(async function () {
    [admin, user, outsider] = await ethers.getSigners();
    cst = await ethers.deployContract('CSTToken');
    exchange = await ethers.deployContract('ChainTradeExchange', [
      await cst.getAddress(),
      ref('test deployment'),
    ]);
    market = await exchange.getAddress();
    btc = await ethers.deployContract('SyntheticAssetToken', [
      'Synthetic Bitcoin',
      'BTCX',
      market,
      u('1000'),
    ]);
    btcAddress = await btc.getAddress();
    await exchange.addAsset(btcAddress, price);
    await cst.mintLiquidity(market, u('1000000'));
    await cst.grantStarter(user.address);
  });

  it('funds exactly 10,000 CST once, with an 18-decimal supply and a separate exchange reserve', async function () {
    expect(await cst.name()).to.equal('ChainTrade Token');
    expect(await cst.symbol()).to.equal('CST');
    expect(await cst.decimals()).to.equal(18);
    expect(await cst.balanceOf(user.address)).to.equal(u('10000'));
    expect(await cst.totalSupply()).to.equal(u('1010000'));
    expect(await btc.decimals()).to.equal(18);
    expect(await btc.balanceOf(user.address)).to.equal(0n);
    await expect(cst.grantStarter(user.address)).to.be.revertedWithCustomError(
      cst,
      'AlreadyFunded',
    );
    await expect(
      cst.connect(outsider).grantStarter(outsider.address),
    ).to.be.revertedWithCustomError(cst, 'OwnableUnauthorizedAccount');
    await expect(
      cst.connect(outsider).mintLiquidity(outsider.address, u('5')),
    ).to.be.revertedWithCustomError(cst, 'OwnableUnauthorizedAccount');
    await expect(cst.grantStarter(outsider.address))
      .to.emit(cst, 'StarterReward')
      .withArgs(outsider.address, u('10000'));
  });

  it('restricts price updates to the admin and records the old and new price', async function () {
    const next = u('69100.125');
    await expect(
      exchange.connect(user).setPrices([btcAddress], [next]),
    ).to.be.revertedWithCustomError(exchange, 'OwnableUnauthorizedAccount');
    await expect(exchange.connect(admin).setPrices([btcAddress], [next]))
      .to.emit(exchange, 'PriceUpdated')
      .withArgs(btcAddress, price, next);
    expect(await exchange.prices(btcAddress)).to.equal(next);
    await expect(exchange.setPrices([btcAddress], [0n])).to.be.revertedWithCustomError(
      exchange,
      'InvalidPrice',
    );
    await expect(exchange.setPrices([btcAddress], [])).to.be.revertedWithCustomError(
      exchange,
      'InvalidPrice',
    );
  });

  it('buys fractional assets with exact CST arithmetic and emits all fill fields', async function () {
    const quantity = u('0.0123');
    const total = u('841.566');
    await cst.connect(user).approve(market, total);
    await expect(exchange.connect(user).trade(btcAddress, true, quantity, price, ref('buy')))
      .to.emit(exchange, 'TradeExecuted')
      .withArgs(user.address, btcAddress, ref('buy'), true, quantity, price, total);
    expect(await cst.balanceOf(user.address)).to.equal(u('10000') - total);
    expect(await btc.balanceOf(user.address)).to.equal(quantity);
    expect(await btc.balanceOf(market)).to.equal(u('1000') - quantity);
  });

  it('sells purchased units and pays the new on-chain price', async function () {
    await cst.connect(user).approve(market, u('684.2'));
    await exchange.connect(user).trade(btcAddress, true, u('0.01'), price, ref('buy'));
    const next = u('70000');
    await exchange.setPrices([btcAddress], [next]);
    const sell = u('0.005');
    await btc.connect(user).approve(market, sell);
    await expect(exchange.connect(user).trade(btcAddress, false, sell, next, ref('sell')))
      .to.emit(exchange, 'TradeExecuted')
      .withArgs(user.address, btcAddress, ref('sell'), false, sell, next, u('350'));
    expect(await btc.balanceOf(user.address)).to.equal(sell);
    expect(await cst.balanceOf(user.address)).to.equal(u('9665.8'));
  });

  it('rejects buys above available CST and sells above the owned amount', async function () {
    await expect(
      exchange.connect(user).trade(btcAddress, true, u('1'), price, ref('overbuy')),
    ).to.be.revertedWithCustomError(exchange, 'InsufficientBalance');
    await expect(
      exchange.connect(user).trade(btcAddress, false, u('1'), price, ref('oversell')),
    ).to.be.revertedWithCustomError(exchange, 'InsufficientBalance');
  });

  it('rejects zero quantities on both sides and unknown assets', async function () {
    for (const buy of [true, false]) {
      await expect(
        exchange.connect(user).trade(btcAddress, buy, 0, price, ref('zero')),
      ).to.be.revertedWithCustomError(exchange, 'InvalidQuantity');
    }
    await expect(
      exchange.connect(user).trade(outsider.address, true, u('1'), price, ref('unknown')),
    ).to.be.revertedWithCustomError(exchange, 'InvalidAsset');
  });

  it('enforces token approvals and leaves unfilled orders retriable', async function () {
    const order = ref('retry');
    await expect(
      exchange.connect(user).trade(btcAddress, true, u('0.01'), price, order),
    ).to.be.revertedWithCustomError(cst, 'ERC20InsufficientAllowance');
    expect(await exchange.filled(user.address, order)).to.equal(false);
    await cst.connect(user).approve(market, u('684.2'));
    await exchange.connect(user).trade(btcAddress, true, u('0.01'), price, order);
    await expect(
      exchange.connect(user).trade(btcAddress, true, u('0.01'), price, order),
    ).to.be.revertedWithCustomError(exchange, 'OrderAlreadyFilled');
  });

  it('rejects stale prices before moving tokens', async function () {
    await expect(
      exchange.connect(user).trade(btcAddress, true, u('0.01'), u('68000'), ref('stale')),
    ).to.be.revertedWithCustomError(exchange, 'PriceChanged');
    expect(await cst.balanceOf(user.address)).to.equal(u('10000'));
  });

  it('allows only the admin to pause or resume and blocks both trade directions while paused', async function () {
    await expect(exchange.connect(user).pause()).to.be.revertedWithCustomError(
      exchange,
      'OwnableUnauthorizedAccount',
    );
    await expect(exchange.pause()).to.emit(exchange, 'Paused').withArgs(admin.address);
    for (const buy of [true, false]) {
      await expect(
        exchange.connect(user).trade(btcAddress, buy, u('0.01'), price, ref('paused')),
      ).to.be.revertedWithCustomError(exchange, 'EnforcedPause');
    }
    await expect(exchange.connect(user).resume()).to.be.revertedWithCustomError(
      exchange,
      'OwnableUnauthorizedAccount',
    );
    await expect(exchange.resume()).to.emit(exchange, 'Unpaused').withArgs(admin.address);
    await cst.connect(user).approve(market, u('684.2'));
    await expect(
      exchange.connect(user).trade(btcAddress, true, u('0.01'), price, ref('resumed')),
    ).to.emit(exchange, 'TradeExecuted');
  });

  it('validates available liquidity before moving funds', async function () {
    await cst.mintLiquidity(user.address, u('1000000000'));
    await expect(
      exchange.connect(user).trade(btcAddress, true, u('1001'), price, ref('liquidity')),
    ).to.be.revertedWithCustomError(exchange, 'InsufficientLiquidity');
  });
});
