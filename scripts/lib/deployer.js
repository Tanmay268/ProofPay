"use strict";
// Deploys the full ProofPay stack with any ethers v6 signer, reading compiled
// artifacts from disk (run `npm run compile` first). Shared by deploy.js and
// the demo orchestrator so there is one deployment recipe.
const fs = require("fs");
const path = require("path");
const { ContractFactory, parseEther } = require("ethers");
const { poseidonContract } = require("circomlibjs");

const art = (rel) => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "artifacts", "contracts", rel), "utf8"));

async function deployStack(signer, { owner, maxDepositEth = "1" } = {}) {
  const ownerAddr = owner ?? (await signer.getAddress());
  const dep = async (factory, ...args) => {
    const c = await factory.deploy(...args);
    await c.waitForDeployment();
    return c;
  };
  const p2 = await dep(new ContractFactory(poseidonContract.generateABI(2), poseidonContract.createCode(2), signer));
  const p3 = await dep(new ContractFactory(poseidonContract.generateABI(3), poseidonContract.createCode(3), signer));
  const v = art("generated/PayVerifier.sol/PayVerifier.json");
  const verifier = await dep(new ContractFactory(v.abi, v.bytecode, signer));
  const s = art("ShieldedPool.sol/ShieldedPool.json");
  const pool = await dep(new ContractFactory(s.abi, s.bytecode, signer), ownerAddr, p2, p3, verifier, parseEther(maxDepositEth));
  const b = art("BlocklistPolicy.sol/BlocklistPolicy.json");
  const policy = await dep(new ContractFactory(b.abi, b.bytecode, signer), ownerAddr);
  return {
    pool,
    policy,
    addresses: {
      pool: await pool.getAddress(),
      blocklistPolicy: await policy.getAddress(),
      poseidon2: await p2.getAddress(),
      poseidon3: await p3.getAddress(),
      payVerifier: await verifier.getAddress(),
      owner: ownerAddr,
    },
  };
}

module.exports = { deployStack };
