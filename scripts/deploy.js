// npx hardhat run scripts/deploy.js --network sepolia      (free: needs faucet ETH + a free public RPC)
// Env: OWNER (optional, defaults to deployer; use a multisig for anything real),
//      MAX_DEPOSIT_ETH (default 1)
const { ethers, network } = require("hardhat");
const { deployStack } = require("./lib/deployer");

async function main() {
  const [deployer] = await ethers.getSigners();
  const { addresses } = await deployStack(deployer, {
    owner: process.env.OWNER,
    maxDepositEth: process.env.MAX_DEPOSIT_ETH ?? "1",
  });
  console.log(JSON.stringify({ network: network.name, ...addresses, deployBlock: await ethers.provider.getBlockNumber() }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
