"use strict";
// Compliance v1 (decisions.md D9): voluntary, per-payment disclosure.
// A payer hands an auditor a Disclosure; the auditor recomputes the record
// commitment and checks it against the pool's public Payment event. Only that
// ONE payment is revealed; the payer's deposits and other payments stay hidden.
const sdk = require("./index");

function makeDisclosure(payment, recordIndex) {
  return {
    invoiceId: payment.invoiceId.toString(),
    merchant: payment.merchant.toString(),
    amount: payment.amount.toString(),
    paySecret: payment.paySecret.toString(),
    recordIndex,
  };
}

/** @returns {Promise<{ok:boolean, reason?:string, txHash?:string}>} */
async function verifyDisclosure(pool, d) {
  const rec = sdk.recordCommit(BigInt(d.invoiceId), BigInt(d.merchant), BigInt(d.amount), BigInt(d.paySecret));
  const evs = await pool.queryFilter(pool.filters.Payment(BigInt(d.invoiceId)));
  const hit = evs.find((e) => BigInt(e.args.recordCommitment) === rec && Number(e.args.recordIndex) === d.recordIndex);
  if (!hit) return { ok: false, reason: "no matching on-chain payment" };
  if (BigInt(hit.args.merchant) !== BigInt(d.merchant) || BigInt(hit.args.amount) !== BigInt(d.amount)) {
    return { ok: false, reason: "event/disclosure mismatch" };
  }
  return { ok: true, txHash: hit.transactionHash };
}

module.exports = { makeDisclosure, verifyDisclosure };
