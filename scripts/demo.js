"use strict";
// One command, zero cost: local chain + deploy + relayer + verifier + demo UI.
//   npm run demo      then open http://127.0.0.1:3000
const { spawn } = require("child_process");
const path = require("path");
const { JsonRpcProvider, parseEther } = require("ethers");
const { deployStack } = require("./lib/deployer");
const sdk = require("../sdk");
const { RootCache } = require("../sdk/chain");
const { createRelayerApp } = require("../services/relayer/app");
const { createVerifierApp } = require("../services/verifier-api/app");
const { createDemoApp } = require("../services/demo/daemon");

const RPC = "http://127.0.0.1:8545";
const VERIFIER_ID = 1001n;

function startChain() {
  const bin = path.join(__dirname, "..", "node_modules", "hardhat", "internal", "cli", "bootstrap.js");
  const child = spawn(process.execPath, [bin, "node", "--hostname", "127.0.0.1", "--port", "8545"], { cwd: path.join(__dirname, ".."), stdio: ["ignore", "pipe", "inherit"] });
  return new Promise((resolve, reject) => {
    child.on("exit", (c) => reject(new Error(`hardhat node exited (${c}); is port 8545 already in use?`)));
    child.stdout.on("data", (d) => /Started HTTP/.test(d.toString()) && resolve(child));
  });
}

async function main() {
  await sdk.init();
  const chain = await startChain();
  const stop = () => { chain.kill(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const provider = new JsonRpcProvider(RPC, undefined, { staticNetwork: true, batchMaxCount: 1 });
  const [deployer, payer, merchantMain, relayerS, auditor] = await Promise.all([0, 1, 2, 3, 4].map((i) => provider.getSigner(i)));
  const { pool, policy, addresses } = await deployStack(deployer, { maxDepositEth: "10" });
  console.log("deployed", addresses);

  const relayerApp = createRelayerApp({ pool: pool.connect(relayerS), minFee: parseEther("0.005") });
  await relayerApp.listen({ port: 8788, host: "127.0.0.1" });

  const cache = new RootCache(pool, { minResyncMs: 0 });
  const verifierApp = createVerifierApp({
    vkey: require("../build/receipt_vkey.json"),
    verifierId: VERIFIER_ID.toString(),
    isKnownRoot: (r) => cache.has(r),
  });
  await verifierApp.listen({ port: 8787, host: "127.0.0.1" });

  const ui = createDemoApp({
    provider, pool, policy,
    signers: { owner: deployer, payer, merchantMain, auditor },
    relayerUrl: "http://127.0.0.1:8788",
    verifierUrl: "http://127.0.0.1:8787",
    verifierId: VERIFIER_ID,
  });
  await ui.listen({ port: 3000, host: "127.0.0.1" });
  console.log("\nProofPay demo is running. Open http://127.0.0.1:3000   (Ctrl+C to stop)\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
