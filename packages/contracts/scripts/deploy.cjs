const { ethers } = require('hardhat');
const fs = require('node:fs');
const path = require('node:path');

async function main() {
  const location = path.join(__dirname, '../deployment.json');
  if (fs.existsSync(location)) {
    const saved = JSON.parse(fs.readFileSync(location, 'utf8'));
    if ((await ethers.provider.getCode(saved.exchange)) !== '0x') {
      const exchange = await ethers.getContractAt('ChainTradeExchange', saved.exchange);
      if ((await exchange.deploymentId()) !== saved.id)
        throw new Error('Deployment manifest does not match the running chain.');
      console.log('Existing ChainTrade deployment:', saved.exchange);
      return;
    }
    throw new Error(
      'The saved deployment is absent. Follow the README reset steps before redeploying.',
    );
  }
  const cst = await ethers.deployContract('CSTToken');
  await cst.waitForDeployment();
  const id = ethers.hexlify(ethers.randomBytes(32));
  const exchange = await ethers.deployContract('ChainTradeExchange', [await cst.getAddress(), id]);
  const receipt = await exchange.deploymentTransaction().wait();
  const address = await exchange.getAddress();
  const assets = {};
  for (const [symbol, name, price] of [
    ['BTCX', 'Synthetic Bitcoin', '68420'],
    ['ETHX', 'Synthetic Ethereum', '3540'],
    ['SOLX', 'Synthetic Solana', '172'],
  ]) {
    const token = await ethers.deployContract('SyntheticAssetToken', [
      name,
      symbol,
      address,
      ethers.parseEther('1000000'),
    ]);
    await token.waitForDeployment();
    assets[symbol] = await token.getAddress();
    await (await exchange.addAsset(assets[symbol], ethers.parseEther(price))).wait();
  }
  await (await cst.mintLiquidity(address, ethers.parseEther('1000000000'))).wait();
  const manifest = {
    id,
    chainId: 31337,
    startBlock: receipt.blockNumber,
    cst: await cst.getAddress(),
    exchange: address,
    assets,
  };
  fs.writeFileSync(location, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  console.log('Deployed ChainTrade exchange:', address);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
