"use strict";
const { MerkleTree } = require("./index");

/**
 * Rebuild the pool's Merkle tree from on-chain events and check it against the
 * contract's current root. Throws if the replica and the chain disagree.
 */
async function syncTree(pool, fromBlock = 0) {
  const leaves = new Map();
  for (const e of await pool.queryFilter(pool.filters.Deposit(), fromBlock)) {
    leaves.set(Number(e.args.leafIndex), BigInt(e.args.commitment));
  }
  for (const e of await pool.queryFilter(pool.filters.Payment(), fromBlock)) {
    leaves.set(Number(e.args.changeIndex), BigInt(e.args.changeCommitment));
    leaves.set(Number(e.args.recordIndex), BigInt(e.args.recordCommitment));
  }
  const tree = new MerkleTree();
  for (let i = 0; i < leaves.size; i++) {
    if (!leaves.has(i)) throw new Error(`missing leaf ${i}`);
    tree.insert(leaves.get(i));
  }
  const onChain = BigInt(await pool.getLastRoot());
  if (tree.root !== onChain) throw new Error("replica root != on-chain root");
  return tree;
}

module.exports = { syncTree };

/**
 * Query-private root check (decisions.md D10). The verifier mirrors the pool's
 * root-history ring by syncing the public RootAdded log, so checking a
 * receipt's root never sends that root (or anything derived from the receipt)
 * to the RPC provider. Only the bulk log sync is visible.
 */
class RootCache {
  constructor(pool, { historySize = 100, minResyncMs = 5000 } = {}) {
    this.pool = pool;
    this.historySize = historySize;
    this.minResyncMs = minResyncMs;
    this.roots = [];
    this.nextBlock = 0;
    this.lastSync = 0;
  }
  async sync() {
    const head = await this.pool.runner.provider.getBlockNumber();
    if (head < this.nextBlock) return;
    const evs = await this.pool.queryFilter(this.pool.filters.RootAdded(), this.nextBlock, head);
    for (const e of evs) this.roots.push(BigInt(e.args.root));
    if (this.roots.length > this.historySize) this.roots = this.roots.slice(-this.historySize);
    this.nextBlock = head + 1;
    this.lastSync = Date.now();
  }
  /** Local lookup; resyncs at most once per minResyncMs when the root is unknown. */
  async has(root) {
    if (this.roots.includes(root)) return true;
    if (Date.now() - this.lastSync >= this.minResyncMs) {
      await this.sync();
      return this.roots.includes(root);
    }
    return false;
  }
}

module.exports.RootCache = RootCache;
