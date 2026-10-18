const { ethers } = require("hardhat");
const { poseidonContract } = require("circomlibjs");

async function deployPoseidon(n, signer) {
  const f = new ethers.ContractFactory(poseidonContract.generateABI(n), poseidonContract.createCode(n), signer);
  const c = await f.deploy();
  await c.waitForDeployment();
  return c;
}

async function deployAll(maxDepositEth = "10") {
  const [owner, alice, bob, merchant, relayer, auditor] = await ethers.getSigners();
  const p2 = await deployPoseidon(2, owner);
  const p3 = await deployPoseidon(3, owner);
  const verifier = await (await ethers.getContractFactory("PayVerifier")).deploy();
  const pool = await (await ethers.getContractFactory("ShieldedPool")).deploy(
    owner.address, p2, p3, verifier, ethers.parseEther(maxDepositEth)
  );
  await pool.waitForDeployment();
  return { pool, owner, alice, bob, merchant, relayer, auditor };
}

module.exports = { deployAll, E: ethers.parseEther };
