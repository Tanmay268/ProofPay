"use strict";
// Usage: RPC_URL=... POOL_ADDRESS=0x... VERIFIER_ID=<decimal> [DB_PATH=receipts.db] [PORT=8787] node services/verifier-api/server.js
const { ethers } = require("ethers");
const { createVerifierApp } = require("./app");
const { RootCache } = require("../../sdk/chain");
const artifact = require("../../artifacts/contracts/ShieldedPool.sol/ShieldedPool.json");

const need = (k) => {
  if (!process.env[k]) throw new Error(`missing env ${k}`);
  return process.env[k];
};

const provider = new ethers.JsonRpcProvider(need("RPC_URL"));
const pool = new ethers.Contract(need("POOL_ADDRESS"), artifact.abi, provider);
const cache = new RootCache(pool); // query-private: roots are checked locally (decisions.md D10)

const app = createVerifierApp({
  vkey: require("../../build/receipt_vkey.json"),
  verifierId: need("VERIFIER_ID"),
  isKnownRoot: (r) => cache.has(r),
  dbPath: process.env.DB_PATH ?? "receipts.db",
  logger: true,
});

cache.sync().then(() => {
  setInterval(() => cache.sync().catch((e) => app.log.warn(e.message)), 15000).unref();
  return app.listen({ port: Number(process.env.PORT ?? 8787), host: process.env.HOST ?? "127.0.0.1" });
}).catch((e) => {
  app.log.error(e);
  process.exit(1);
});
