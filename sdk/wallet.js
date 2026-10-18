"use strict";
// High-level helpers that glue proving to contract calls. Used by tests, the
// demo daemon and scripts, so there is exactly one implementation of the flow.
const sdk = require("./index");
const { syncTree } = require("./chain");

const NO_STEALTH = { viewTag: "0x00", ephemeralPubKey: "0x" };

/** Deposit `value` wei; returns the note with its leaf index. */
async function depositNote(pool, signer, value) {
  const note = sdk.newNote(value);
  const rc = await (await pool.connect(signer).deposit(note.ownerCommit, { value: note.value })).wait();
  const ev = rc.logs.map((l) => pool.interface.parseLog(l)).find((p) => p && p.name === "Deposit");
  if (BigInt(ev.args.commitment) !== note.commitment) throw new Error("commitment mismatch");
  return { ...note, index: Number(ev.args.leafIndex) };
}

/**
 * Build a pay proof. `relayer` must equal the address that will submit it
 * (the payer's own address for self-submission, or the relayer's address).
 */
async function buildPayment(pool, note, { amount, invoiceId, merchant, relayer, fee = 0n, stealth = NO_STEALTH, tree }) {
  tree = tree ?? (await syncTree(pool));
  const built = sdk.buildPayInput(tree, note, amount, invoiceId, merchant, { relayer, fee });
  const { proof } = await sdk.provePay(built.input);
  const p = sdk.toSolidityProof(proof);
  const i = built.input;
  const args = [p.a, p.b, p.c, i.root, i.nullifier, i.payAmount, i.invoiceId, merchant, i.fee, i.changeCommitment, i.recordCommitment, stealth];
  return { built, args, relayerBody: toRelayerBody(args) };
}

function toRelayerBody(args) {
  const s = (x) => x.toString();
  const [a, b, c, root, nullifier, amount, invoiceId, merchant, fee, changeCommitment, recordCommitment, stealth] = args;
  return {
    a: a.map(s), b: b.map((r) => r.map(s)), c: c.map(s),
    root: s(root), nullifier: s(nullifier), amount: s(amount), invoiceId: s(invoiceId),
    merchant, fee: s(fee), changeCommitment: s(changeCommitment), recordCommitment: s(recordCommitment),
    stealth,
  };
}

/** After a Payment tx: locate the record leaf and the change note index. */
function parsePayment(pool, receipt) {
  const ev = receipt.logs.map((l) => { try { return pool.interface.parseLog(l); } catch { return null; } }).find((p) => p && p.name === "Payment");
  return { recordIndex: Number(ev.args.recordIndex), changeIndex: Number(ev.args.changeIndex) };
}

module.exports = { depositNote, buildPayment, toRelayerBody, parsePayment, NO_STEALTH };
