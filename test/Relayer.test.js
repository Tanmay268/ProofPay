const { expect } = require("chai");
const { ethers } = require("hardhat");
const sdk = require("../sdk");
const { depositNote, buildPayment } = require("../sdk/wallet");
const { createRelayerApp } = require("../services/relayer/app");
const { deployAll, E } = require("./helpers");

describe("relayer service", function () {
  before(async () => sdk.init());

  it("submits a fee-bound payment for an anonymous payer and rejects bad ones", async () => {
    const { pool, alice, merchant, relayer } = await deployAll();
    const app = createRelayerApp({ pool: pool.connect(relayer), minFee: E("0.005") });
    const info = (await app.inject({ method: "GET", url: "/info" })).json();
    expect(info.address).to.equal(relayer.address);

    const note = await depositNote(pool, alice, E("1"));
    const p = await buildPayment(pool, note, { amount: E("0.2"), invoiceId: 21n, merchant: merchant.address, relayer: info.address, fee: E("0.01") });
    const before = await ethers.provider.getBalance(merchant.address);
    const res = await app.inject({ method: "POST", url: "/relay", payload: p.relayerBody });
    expect(res.statusCode).to.equal(200);
    expect((await ethers.provider.getBalance(merchant.address)) - before).to.equal(E("0.2"));

    const again = await app.inject({ method: "POST", url: "/relay", payload: p.relayerBody });
    expect(again.statusCode).to.equal(422);
    expect(again.json().error).to.equal("would_revert");

    const n2 = await depositNote(pool, alice, E("1"));
    const cheap = await buildPayment(pool, n2, { amount: E("0.2"), invoiceId: 22n, merchant: merchant.address, relayer: info.address, fee: E("0.001") });
    expect((await app.inject({ method: "POST", url: "/relay", payload: cheap.relayerBody })).json().error).to.equal("fee_too_low");

    expect((await app.inject({ method: "POST", url: "/relay", payload: { a: 1 } })).statusCode).to.equal(400);
    await app.close();
  });
});
