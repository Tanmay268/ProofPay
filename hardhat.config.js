require("@nomicfoundation/hardhat-toolbox");

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: "cancun" },
  },
  networks: {
    hardhat: { allowUnlimitedContractSize: false },
    ...(process.env.SEPOLIA_RPC_URL && process.env.DEPLOYER_KEY
      ? { sepolia: { url: process.env.SEPOLIA_RPC_URL, accounts: [process.env.DEPLOYER_KEY] } }
      : {}),
  },
  mocha: { timeout: 600000 },
  gasReporter: { enabled: !!process.env.REPORT_GAS },
};
