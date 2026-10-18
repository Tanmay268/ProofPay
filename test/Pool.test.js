const { expect } = require("chai");
const { ethers } = require("hardhat");
const sdk = require("../sdk");
const { syncTree, RootCache } = require("../sdk/chain");
const { depositNote, buildPayment, parsePayment } = require("../sdk/wallet");
const stealth = require("../sdk/stealth");
const compliance = require("../sdk/compliance");
const { deployAll, E } = require("./helpers");

async function selfPay(pool, signer, note, amount, invoiceId, merchantAddr, extra = {}) {
  const p = await buildPayment(pool, note, { amount, invoiceId, merchant: merchantAddr, relayer: signer.address, ...extra });
  const rc = await (await pool.connect(signer).pay(...p.args)).wait();
  return { ...p, rc, ...parsePayment(pool, rc) };
}

describe("ShieldedPool", function () {
  before(async () => sdk.init());

  it("off-chain tree replica matches the contract", async () => {
    const { pool, alice } = await deployAll();
    expect(await pool.getLastRoot()).to.equal(new sdk.MerkleTree().root);
    await depositNote(pool, alice, E("1"));
    await depositNote(pool, alice, E("2"));
    await syncTree(pool);
  });

  it("deposit -> pay -> receipt -> spend change", async () => {
    const { pool, alice, merchant } = await deployAll();
    const note = await depositNote(pool, alice, E("1"));
    const before = await ethers.provider.getBalance(merchant.address);
    const r = await selfPay(pool, alice, note, E("0.4"), sdk.randomField(), merchant.address);
    console.log("      pay() gas:", r.rc.gasUsed.toString());
    expect((await ethers.provider.getBalance(merchant.address)) - before).to.equal(E("0.4"));
    expect(await pool.nullifierSpent(r.built.input.nullifier)).to.equal(true);

    const tree = await syncTree(pool);
    const rin = sdk.buildReceiptInput(tree, r.built.payment, r.recordIndex, E("0.3"), 7n);
    const { proof, publicSignals } = await sdk.proveReceipt(rin);
    expect(await sdk.verifyReceiptProof(proof, publicSignals)).to.equal(true);
    expect(BigInt(publicSignals[5])).to.equal(rin.receiptNullifier);
    expect(sdk.receiptNullifier(r.built.payment.paySecret, r.built.payment.invoiceId, 8n)).to.not.equal(rin.receiptNullifier);
    const bad = [...publicSignals];
    bad[3] = E("0.5").toString();
    expect(await sdk.verifyReceiptProof(proof, bad)).to.equal(false);

    const change = { ...r.built.changeNote, index: r.changeIndex };
    await selfPay(pool, alice, change, E("0.6"), sdk.randomField(), merchant.address);
  });

  it("receipt cannot claim more than was paid", async () => {
    const { pool, alice, merchant } = await deployAll();
    const note = await depositNote(pool, alice, E("1"));
    const r = await selfPay(pool, alice, note, E("0.2"), 5n, merchant.address);
    const tree = await syncTree(pool);
    await expect(sdk.proveReceipt(sdk.buildReceiptInput(tree, r.built.payment, r.recordIndex, E("0.3"), 1n))).to.be.rejected;
  });

  it("rejects double spend, wrong recipient, wrong submitter, unknown root, fee tampering, overspend", async () => {
    const { pool, alice, bob, merchant } = await deployAll();
    const note = await depositNote(pool, alice, E("1"));
    const r = await selfPay(pool, alice, note, E("0.1"), 1n, merchant.address);
    await expect(pool.connect(alice).pay(...r.args)).to.be.revertedWithCustomError(pool, "NullifierAlreadySpent");

    const n2 = await depositNote(pool, alice, E("1"));
    const p = await buildPayment(pool, n2, { amount: E("0.1"), invoiceId: 2n, merchant: merchant.address, relayer: alice.address });
    const swapped = [...p.args];
    swapped[7] = bob.address;
    await expect(pool.connect(alice).pay(...swapped)).to.be.revertedWithCustomError(pool, "InvalidProof");
    await expect(pool.connect(bob).pay(...p.args)).to.be.revertedWithCustomError(pool, "InvalidProof");
    const badRoot = [...p.args];
    badRoot[3] = 12345n;
    await expect(pool.connect(alice).pay(...badRoot)).to.be.revertedWithCustomError(pool, "UnknownRoot");
    const fee = [...p.args];
    fee[8] = 1n;
    await expect(pool.connect(alice).pay(...fee)).to.be.revertedWithCustomError(pool, "InvalidProof");
    const forged = { ...p.built.input, payAmount: n2.value + 1n, changeValue: sdk.FIELD - 1n };
    await expect(sdk.provePay(forged)).to.be.rejected;
  });

  it("pays a relayer fee that the proof binds", async () => {
    const { pool, alice, merchant, relayer } = await deployAll();
    const note = await depositNote(pool, alice, E("1"));
    const fee = E("0.01");
    const before = await ethers.provider.getBalance(relayer.address);
    const p = await buildPayment(pool, note, { amount: E("0.3"), invoiceId: 3n, merchant: merchant.address, relayer: relayer.address, fee });
    const rc = await (await pool.connect(relayer).pay(...p.args)).wait();
    const spent = rc.gasUsed * rc.gasPrice;
    expect((await ethers.provider.getBalance(relayer.address)) - before + spent).to.equal(fee);
    expect(p.built.changeNote.value).to.equal(E("0.69"));
  });

  it("stealth: merchant detects and sweeps a one-time address", async () => {
    const { pool, alice, merchant } = await deployAll();
    const keys = stealth.newMetaKeys();
    const st = stealth.deriveStealthAddress(keys.meta);
    const note = await depositNote(pool, alice, E("1"));
    const r = await selfPay(pool, alice, note, E("0.5"), 11n, st.address, {
      stealth: { viewTag: st.viewTag, ephemeralPubKey: st.ephemeralPubKey },
    });
    expect(await ethers.provider.getBalance(st.address)).to.equal(E("0.5"));

    const [ann] = await pool.queryFilter(pool.filters.StealthAnnouncement());
    const announcement = { ephemeralPubKey: ann.args.ephemeralPubKey, viewTag: ann.args.viewTag, address: ann.args.stealthAddress };
    const found = stealth.recoverStealthKey(keys, announcement, ethers.provider);
    expect(found).to.not.equal(null);
    expect(found.address).to.equal(st.address);
    await (await found.sendTransaction({ to: merchant.address, value: E("0.4") })).wait();

    const other = stealth.newMetaKeys();
    expect(stealth.recoverStealthKey(other, announcement)).to.equal(null);
    expect(r.rc.status).to.equal(1);
  });

  it("compliance: blocklist screens deposits; disclosure proves exactly one payment", async () => {
    const { pool, owner, alice, bob, merchant } = await deployAll();
    const policy = await (await ethers.getContractFactory("BlocklistPolicy")).deploy(owner.address);
    await pool.connect(owner).setDepositPolicy(policy);
    await policy.connect(owner).setBlocked(bob.address, true);
    const bn = sdk.newNote(E("1"));
    await expect(pool.connect(bob).deposit(bn.ownerCommit, { value: bn.value })).to.be.revertedWithCustomError(pool, "DepositNotAllowed");

    const note = await depositNote(pool, alice, E("1"));
    const r = await selfPay(pool, alice, note, E("0.25"), 77n, merchant.address);
    const d = compliance.makeDisclosure(r.built.payment, r.recordIndex);
    expect((await compliance.verifyDisclosure(pool, d)).ok).to.equal(true);
    expect((await compliance.verifyDisclosure(pool, { ...d, amount: E("0.26").toString() })).ok).to.equal(false);
    expect((await compliance.verifyDisclosure(pool, { ...d, paySecret: "1" })).ok).to.equal(false);
  });

  it("RootCache mirrors the on-chain root ring", async () => {
    const { pool, alice, merchant } = await deployAll();
    const cache = new RootCache(pool, { minResyncMs: 0 });
    const note = await depositNote(pool, alice, E("1"));
    await selfPay(pool, alice, note, E("0.1"), 9n, merchant.address);
    expect(await cache.has(BigInt(await pool.getLastRoot()))).to.equal(true);
    expect(await cache.has(123456789n)).to.equal(false);
    for (let i = 0; i < 4; i++) {
      const root = BigInt(await pool.roots(i));
      if (root !== 0n) expect(await cache.has(root)).to.equal(await pool.isKnownRoot(root));
    }
  });

  it("invariants under random operations: solvency, replica root, no value creation", async () => {
    const { pool, alice, merchant } = await deployAll();
    const notes = [];
    let paidOut = 0n;
    let deposited = 0n;
    for (let step = 0; step < 6; step++) {
      if (notes.length === 0 || Math.random() < 0.4) {
        const v = E(String(1 + Math.floor(Math.random() * 3)));
        notes.push(await depositNote(pool, alice, v));
        deposited += v;
      } else {
        const idx = Math.floor(Math.random() * notes.length);
        const n = notes[idx];
        const amount = (n.value * BigInt(1 + Math.floor(Math.random() * 9))) / 10n;
        const r = await selfPay(pool, alice, n, amount, sdk.randomField(), merchant.address);
        paidOut += amount;
        notes.splice(idx, 1);
        notes.push({ ...r.built.changeNote, index: r.changeIndex });
      }
      await syncTree(pool);
      const unspent = notes.reduce((s, n) => s + n.value, 0n);
      expect(await ethers.provider.getBalance(await pool.getAddress())).to.equal(unspent);
      expect(deposited - paidOut).to.equal(unspent);
    }
  });

  it("admin controls: deposit cap, pause, two-step ownership", async () => {
    const { pool, owner, alice, bob } = await deployAll();
    const n = sdk.newNote(E("11"));
    await expect(pool.connect(alice).deposit(n.ownerCommit, { value: n.value })).to.be.revertedWithCustomError(pool, "ExceedsMaxDeposit");
    await expect(pool.connect(alice).deposit(1n, { value: 0 })).to.be.revertedWithCustomError(pool, "InvalidAmount");
    await expect(pool.connect(alice).pause()).to.be.reverted;
    await pool.connect(owner).pause();
    await expect(pool.connect(alice).deposit(1n, { value: 1 })).to.be.revertedWithCustomError(pool, "EnforcedPause");
    await pool.connect(owner).unpause();
    await pool.connect(owner).transferOwnership(bob.address);
    expect(await pool.owner()).to.equal(owner.address);
    await pool.connect(bob).acceptOwnership();
    expect(await pool.owner()).to.equal(bob.address);
  });
});
