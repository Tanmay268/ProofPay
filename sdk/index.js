"use strict";
// ProofPay SDK: note management, off-chain Merkle replica, proof generation.
const path = require("path");
const crypto = require("crypto");
const snarkjs = require("snarkjs");
const { buildPoseidon } = require("circomlibjs");
const { keccak256, toUtf8Bytes } = require("ethers");

const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const TREE_DEPTH = 20;
const MAX_AMOUNT = (1n << 96n) - 1n;
const TAG = { NOTE: 1n, OWNER: 2n, NULL: 3n, RECORD: 4n, RECEIPT: 5n };
const BUILD = path.join(__dirname, "..", "build");

let poseidon = null;
async function init() {
  if (!poseidon) poseidon = await buildPoseidon();
  return poseidon;
}
function H(inputs) {
  if (!poseidon) throw new Error("call init() first");
  return poseidon.F.toObject(poseidon(inputs.map(BigInt)));
}

/** Uniform-enough random field element (248 bits, always < FIELD). */
function randomField() {
  return BigInt("0x" + crypto.randomBytes(31).toString("hex"));
}

const ownerCommit = (secret) => H([TAG.OWNER, secret]);
const noteCommit = (value, secret) => H([TAG.NOTE, value, ownerCommit(secret)]);
const nullifierOf = (secret, leafIndex) => H([TAG.NULL, secret, BigInt(leafIndex)]);
const recordCommit = (invoiceId, merchant, amount, paySecret) =>
  H([TAG.RECORD, invoiceId, BigInt(merchant), amount, paySecret]);
const receiptNullifier = (paySecret, invoiceId, verifierId) =>
  H([TAG.RECEIPT, paySecret, invoiceId, verifierId]);

/** Must match the zero leaf used by ShieldedPool. */
const ZERO_LEAF = BigInt(keccak256(toUtf8Bytes("ProofPay"))) % FIELD;

/** Off-chain replica of the pool's incremental Merkle tree. */
class MerkleTree {
  constructor(depth = TREE_DEPTH) {
    this.depth = depth;
    this.zeros = [ZERO_LEAF];
    for (let i = 1; i <= depth; i++) this.zeros.push(H([this.zeros[i - 1], this.zeros[i - 1]]));
    this.levels = Array.from({ length: depth + 1 }, () => new Map());
    this.size = 0;
  }
  get root() {
    return this.levels[this.depth].get(0) ?? this.zeros[this.depth];
  }
  _node(level, idx) {
    return this.levels[level].get(idx) ?? this.zeros[level];
  }
  insert(leaf) {
    const index = this.size++;
    let cur = index;
    let node = BigInt(leaf);
    this.levels[0].set(cur, node);
    for (let l = 0; l < this.depth; l++) {
      const sib = this._node(l, cur ^ 1);
      node = cur % 2 === 0 ? H([node, sib]) : H([sib, node]);
      cur >>= 1;
      this.levels[l + 1].set(cur, node);
    }
    return index;
  }
  path(index) {
    const pathElements = [];
    const pathIndices = [];
    let cur = index;
    for (let l = 0; l < this.depth; l++) {
      pathElements.push(this._node(l, cur ^ 1));
      pathIndices.push(cur & 1);
      cur >>= 1;
    }
    return { pathElements, pathIndices };
  }
}

/** Create a new note owned by a fresh secret. */
function newNote(value) {
  const v = BigInt(value);
  if (v <= 0n || v > MAX_AMOUNT) throw new Error("value out of range");
  const secret = randomField();
  return { value: v, secret, ownerCommit: ownerCommit(secret), commitment: noteCommit(v, secret) };
}

/**
 * Build the circuit input for PayInvoice.
 * @param tree   MerkleTree replica containing `note` at `note.index`
 * @param note   {value, secret, index}
 */
function buildPayInput(tree, note, payAmount, invoiceId, merchant, { relayer = 0n, fee = 0n } = {}) {
  const amount = BigInt(payAmount);
  const feeAmt = BigInt(fee);
  if (amount <= 0n || feeAmt < 0n || amount + feeAmt > note.value) throw new Error("invalid pay amount");
  const changeValue = note.value - amount - feeAmt;
  const changeSecret = randomField();
  const paySecret = randomField();
  const { pathElements, pathIndices } = tree.path(note.index);
  const changeCommitment = noteCommit(changeValue, changeSecret);
  const recordCommitment = recordCommit(BigInt(invoiceId), BigInt(merchant), amount, paySecret);
  const nullifier = nullifierOf(note.secret, note.index);
  const input = {
    root: tree.root,
    nullifier,
    payAmount: amount,
    invoiceId: BigInt(invoiceId),
    merchant: BigInt(merchant),
    relayer: BigInt(relayer),
    fee: feeAmt,
    changeCommitment,
    recordCommitment,
    value: note.value,
    secret: note.secret,
    pathElements,
    pathIndices,
    changeValue,
    changeSecret,
    paySecret,
  };
  return {
    input,
    changeNote: { value: changeValue, secret: changeSecret, commitment: changeCommitment },
    payment: { invoiceId: BigInt(invoiceId), merchant: BigInt(merchant), amount, paySecret, recordCommitment },
  };
}

function buildReceiptInput(tree, payment, recordIndex, minAmount, verifierId) {
  const { pathElements, pathIndices } = tree.path(recordIndex);
  return {
    root: tree.root,
    invoiceId: payment.invoiceId,
    merchant: payment.merchant,
    minAmount: BigInt(minAmount),
    verifierId: BigInt(verifierId),
    receiptNullifier: receiptNullifier(payment.paySecret, payment.invoiceId, BigInt(verifierId)),
    payAmount: payment.amount,
    paySecret: payment.paySecret,
    pathElements,
    pathIndices,
  };
}

const str = (o) => JSON.parse(JSON.stringify(o, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

async function prove(circuit, input) {
  const wasm = path.join(BUILD, `${circuit}_js`, `${circuit}.wasm`);
  const zkey = path.join(BUILD, `${circuit}.zkey`);
  return snarkjs.groth16.fullProve(str(input), wasm, zkey);
}

/** Convert a snarkjs proof to the (a, b, c) tuple the Solidity verifier expects. */
function toSolidityProof(proof) {
  return {
    a: [proof.pi_a[0], proof.pi_a[1]],
    b: [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]],
    ],
    c: [proof.pi_c[0], proof.pi_c[1]],
  };
}

const provePay = (input) => prove("pay", input);
const proveReceipt = (input) => prove("receipt", input);

async function verifyReceiptProof(proof, publicSignals, vkey) {
  const vk = vkey ?? require(path.join(BUILD, "receipt_vkey.json"));
  return snarkjs.groth16.verify(vk, publicSignals, proof);
}

module.exports = {
  FIELD, TREE_DEPTH, MAX_AMOUNT, TAG, ZERO_LEAF,
  init, H, randomField, ownerCommit, noteCommit, nullifierOf, recordCommit, receiptNullifier,
  MerkleTree, newNote, buildPayInput, buildReceiptInput,
  provePay, proveReceipt, toSolidityProof, verifyReceiptProof,
};
