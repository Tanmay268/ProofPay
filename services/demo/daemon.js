"use strict";
// DEMO ONLY (decisions.md D11). A local "wallet daemon" that plays four roles
// (payer, merchant, third-party verifier, auditor) so the whole protocol can be
// shown from a browser with no cost. Secrets live in this process's memory.
// The reusable client logic is in sdk/; nothing here is a production wallet.
const fs = require("fs");
const path = require("path");
const Fastify = require("fastify");
const { formatEther, parseEther } = require("ethers");
const sdk = require("../../sdk");
const { syncTree } = require("../../sdk/chain");
const { depositNote, buildPayment, parsePayment } = require("../../sdk/wallet");
const stealth = require("../../sdk/stealth");
const compliance = require("../../sdk/compliance");

const RELAYER_FEE = parseEther("0.01");

function createDemoApp({ provider, pool, policy, signers, relayerUrl, verifierUrl, verifierId, logger = false }) {
  const { payer, merchantMain, auditor } = signers;
  const keys = stealth.newMetaKeys();
  const invoices = [];
  const notes = [];
  const payments = [];
  const recovered = new Map(); // stealth address -> Wallet

  const app = Fastify({ logger });
  const html = fs.readFileSync(path.join(__dirname, "public", "index.html"), "utf8");
  app.get("/", async (_, reply) => reply.type("text/html").send(html));

  const bad = (reply, msg, code = 400) => reply.code(code).send({ ok: false, error: msg });
  const eth = (w) => formatEther(w);

  app.get("/api/state", async () => {
    const balance = async (a) => eth(await provider.getBalance(a));
    return {
      verifierId: verifierId.toString(),
      poolBalance: await balance(await pool.getAddress()),
      payerAddress: await payer.getAddress(),
      payerEth: await balance(await payer.getAddress()),
      merchantAddress: await merchantMain.getAddress(),
      merchantEth: await balance(await merchantMain.getAddress()),
      invoices,
      notes: notes.map((n, i) => ({ i, eth: eth(n.value), spent: !!n.spent, index: n.index })),
      payments: payments.map((p, i) => ({ i, invoiceId: p.invoiceId.toString(), eth: eth(p.amount), stealth: p.stealthAddress, txHash: p.txHash, via: p.via, txFrom: p.txFrom })),
      stealthAddresses: await Promise.all([...recovered.keys()].map(async (a) => ({ address: a, eth: await balance(a) }))),
    };
  });

  // ---- merchant ----
  app.post("/api/invoice", async (req, reply) => {
    const { amountEth, memo } = req.body ?? {};
    let amount;
    try { amount = parseEther(String(amountEth)); } catch { return bad(reply, "bad amount"); }
    if (amount <= 0n) return bad(reply, "bad amount");
    const inv = { id: sdk.randomField().toString(), amountEth: String(amountEth), amountWei: amount.toString(), memo: String(memo ?? "").slice(0, 80), paid: false };
    invoices.push(inv);
    return { ok: true, invoice: inv };
  });

  app.post("/api/merchant/scan", async () => {
    const anns = await pool.queryFilter(pool.filters.StealthAnnouncement());
    let found = 0;
    for (const a of anns) {
      const w = stealth.recoverStealthKey(keys, { ephemeralPubKey: a.args.ephemeralPubKey, viewTag: a.args.viewTag, address: a.args.stealthAddress }, provider);
      if (!w) continue;
      recovered.set(w.address, w);
      const inv = invoices.find((i) => i.id === a.args.invoiceId.toString());
      if (inv) inv.paid = true;
      found++;
    }
    return { ok: true, found };
  });

  app.post("/api/merchant/sweep", async () => {
    const dest = await merchantMain.getAddress();
    const fee = await provider.getFeeData();
    const gasPrice = fee.gasPrice;
    let swept = 0n;
    for (const w of recovered.values()) {
      const bal = await provider.getBalance(w.address);
      const cost = 21000n * gasPrice;
      if (bal <= cost) continue;
      await (await w.sendTransaction({ to: dest, value: bal - cost, gasLimit: 21000, gasPrice, type: 0 })).wait();
      swept += bal - cost;
    }
    return { ok: true, swept: eth(swept) };
  });

  // ---- payer ----
  app.post("/api/deposit", async (req, reply) => {
    let v;
    try { v = parseEther(String(req.body?.eth)); } catch { return bad(reply, "bad amount"); }
    try {
      const n = await depositNote(pool, payer, v);
      notes.push(n);
      return { ok: true, note: notes.length - 1, index: n.index };
    } catch (e) {
      return bad(reply, e.shortMessage ?? e.message, 422);
    }
  });

  app.post("/api/pay", async (req, reply) => {
    const { invoiceId, noteIndex, mode } = req.body ?? {};
    const inv = invoices.find((i) => i.id === invoiceId);
    const note = notes[noteIndex];
    if (!inv || !note || note.spent) return bad(reply, "unknown invoice or spent note");
    const useRelayer = mode !== "direct";
    const fee = useRelayer ? RELAYER_FEE : 0n;
    const amount = BigInt(inv.amountWei);
    if (note.value < amount + fee) return bad(reply, "note too small (needs amount + fee)", 422);

    const st = stealth.deriveStealthAddress(keys.meta); // payer derives a fresh one-time recipient from the invoice's meta-address
    const relayerAddr = useRelayer ? (await (await fetch(`${relayerUrl}/info`)).json()).address : await payer.getAddress();
    const t0 = Date.now();
    const p = await buildPayment(pool, note, {
      amount, invoiceId: BigInt(inv.id), merchant: st.address, relayer: relayerAddr, fee,
      stealth: { viewTag: st.viewTag, ephemeralPubKey: st.ephemeralPubKey },
    });
    const proveMs = Date.now() - t0;

    let txHash;
    try {
      if (useRelayer) {
        const r = await fetch(`${relayerUrl}/relay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p.relayerBody) });
        const j = await r.json();
        if (!j.ok) return bad(reply, `relayer: ${j.error} ${j.detail ?? ""}`, 422);
        txHash = j.txHash;
      } else {
        txHash = (await (await pool.connect(payer).pay(...p.args)).wait()).hash;
      }
    } catch (e) {
      return bad(reply, e.shortMessage ?? e.message, 422);
    }
    const rc = await provider.getTransactionReceipt(txHash);
    const { recordIndex, changeIndex } = parsePayment(pool, rc);
    const tx = await provider.getTransaction(txHash);
    note.spent = true;
    notes.push({ ...p.built.changeNote, index: changeIndex });
    payments.push({ ...p.built.payment, stealthAddress: st.address, recordIndex, txHash, via: useRelayer ? "relayer" : "direct", txFrom: tx.from });
    return { ok: true, txHash, proveMs, gasUsed: rc.gasUsed.toString(), txFrom: tx.from, via: useRelayer ? "relayer" : "direct" };
  });

  app.post("/api/receipt", async (req, reply) => {
    const p = payments[req.body?.paymentIndex];
    if (!p) return bad(reply, "unknown payment");
    const tree = await syncTree(pool);
    const rin = sdk.buildReceiptInput(tree, p, p.recordIndex, p.amount, verifierId);
    const t0 = Date.now();
    const { proof, publicSignals } = await sdk.proveReceipt(rin);
    return { ok: true, proveMs: Date.now() - t0, receipt: { proof, publicSignals } };
  });

  app.post("/api/disclosure", async (req, reply) => {
    const p = payments[req.body?.paymentIndex];
    if (!p) return bad(reply, "unknown payment");
    return { ok: true, disclosure: compliance.makeDisclosure(p, p.recordIndex) };
  });

  // ---- third-party verifier & auditor ----
  app.post("/api/verify", async (req, reply) => {
    const r = await fetch(`${verifierUrl}/verify-receipt`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req.body) });
    return reply.code(r.status).send(await r.json());
  });

  app.post("/api/audit", async (req) => compliance.verifyDisclosure(pool, req.body ?? {}));

  // ---- compliance policy toggle ----
  app.post("/api/policy", async (req) => {
    const block = !!req.body?.block;
    const owner = signers.owner;
    if (!(await pool.depositPolicy()) || (await pool.depositPolicy()) === "0x0000000000000000000000000000000000000000") {
      await (await pool.connect(owner).setDepositPolicy(await policy.getAddress())).wait();
    }
    await (await policy.connect(owner).setBlocked(await payer.getAddress(), block)).wait();
    return { ok: true, payerBlocked: block };
  });

  // ---- what an on-chain observer can see ----
  app.get("/api/observer", async () => {
    const out = [];
    for (const e of await pool.queryFilter(pool.filters.Deposit())) {
      const tx = await e.getTransaction();
      out.push({ block: e.blockNumber, kind: "Deposit", from: tx.from, amountEth: eth(e.args.amount), detail: `commitment ${e.args.commitment.toString().slice(0, 14)}…` });
    }
    for (const e of await pool.queryFilter(pool.filters.Payment())) {
      const tx = await e.getTransaction();
      out.push({ block: e.blockNumber, kind: "Payment", from: tx.from, amountEth: eth(e.args.amount), detail: `to one-time address ${e.args.merchant}; nullifier ${e.args.nullifier.toString().slice(0, 14)}…` });
    }
    return out.sort((a, b) => b.block - a.block);
  });

  return app;
}

module.exports = { createDemoApp };
