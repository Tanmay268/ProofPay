"use strict";
// Measures proving time, proof size, verification time, constraints and gas.
//   npm run bench      (needs `npm run setup` and `npm run compile`)
const fs = require("fs");
const path = require("path");
const hre = require("hardhat");
const sdk = require("../sdk");
const { depositNote, buildPayment } = require("../sdk/wallet");
const { deployStack } = require("./lib/deployer");

const E = hre.ethers.parseEther;
const ms = (t0) => Number(process.hrtime.bigint() - t0) / 1e6;
const stat = (xs) => ({ mean: xs.reduce((a, b) => a + b, 0) / xs.length, min: Math.min(...xs), max: Math.max(...xs) });

async function main() {
  await sdk.init();
  const N = Number(process.env.BENCH_RUNS ?? 5);
  const [deployer, payer, merchant] = await hre.ethers.getSigners();
  const { pool } = await deployStack(deployer, { maxDepositEth: "100" });

  const payMs = [], rcpMs = [], verMs = [], payGas = [], depGas = [];
  let payProofBytes = 0, rcpProofBytes = 0;
  for (let i = 0; i < N; i++) {
    const note = await depositNote(pool, payer, E("1"));
    depGas.push(Number((await (await pool.connect(payer).deposit(sdk.newNote(E("1")).ownerCommit, { value: E("1") })).wait()).gasUsed));
    const t0 = process.hrtime.bigint();
    const p = await buildPayment(pool, note, { amount: E("0.1"), invoiceId: sdk.randomField(), merchant: merchant.address, relayer: payer.address });
    payMs.push(ms(t0));
    const rc = await (await pool.connect(payer).pay(...p.args)).wait();
    payGas.push(Number(rc.gasUsed));
    payProofBytes = JSON.stringify(p.args.slice(0, 3)).length;

    const tree = await require("../sdk/chain").syncTree(pool);
    const recIdx = Number(rc.logs.map((l) => { try { return pool.interface.parseLog(l); } catch { return null; } }).find((x) => x && x.name === "Payment").args.recordIndex);
    const rin = sdk.buildReceiptInput(tree, p.built.payment, recIdx, E("0.1"), 1n);
    const t1 = process.hrtime.bigint();
    const { proof, publicSignals } = await sdk.proveReceipt(rin);
    rcpMs.push(ms(t1));
    rcpProofBytes = JSON.stringify(proof).length;
    const t2 = process.hrtime.bigint();
    await sdk.verifyReceiptProof(proof, publicSignals);
    verMs.push(ms(t2));
  }

  const rows = {
    runs: N,
    pay_prove_ms: stat(payMs), receipt_prove_ms: stat(rcpMs), receipt_verify_ms: stat(verMs),
    pay_gas: stat(payGas), deposit_gas: stat(depGas),
    pay_proof_json_bytes: payProofBytes, receipt_proof_json_bytes: rcpProofBytes,
    node: process.version, platform: `${process.platform}/${process.arch}`, cpus: require("os").cpus().length,
  };
  console.log(JSON.stringify(rows, null, 2));
  fs.writeFileSync(path.join(__dirname, "..", "docs", "bench-latest.json"), JSON.stringify(rows, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); }); // snarkjs worker threads keep the loop alive
