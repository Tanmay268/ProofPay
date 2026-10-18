"use strict";
// Receipt verifier service. A third party (merchant, delivery service, ticket
// gate...) runs this to accept ProofPay receipts without learning who paid.
//
// Checks, in order: input shape -> addressed to this verifier -> root is a
// known pool root -> Groth16 proof -> receipt nullifier not seen before.
const Fastify = require("fastify");
const { DatabaseSync } = require("node:sqlite");
const snarkjs = require("snarkjs");

const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const DEC = /^[0-9]{1,78}$/;

const isField = (s) => typeof s === "string" && DEC.test(s) && BigInt(s) < FIELD;
const isG1 = (p) => Array.isArray(p) && p.length === 3 && p.every(isField);
const isG2 = (p) => Array.isArray(p) && p.length === 3 && p.every((x) => Array.isArray(x) && x.length === 2 && x.every(isField));

function validProof(p) {
  return p && isG1(p.pi_a) && isG2(p.pi_b) && isG1(p.pi_c) && p.protocol === "groth16";
}

/**
 * @param opts.vkey         receipt verification key (JSON)
 * @param opts.verifierId   field element identifying THIS verifier (decimal string)
 * @param opts.isKnownRoot  async (rootBigInt) => boolean (e.g. pool.isKnownRoot)
 * @param opts.dbPath       sqlite file (":memory:" for tests)
 */
function createVerifierApp({ vkey, verifierId, isKnownRoot, dbPath = ":memory:", logger = false }) {
  if (!isField(verifierId)) throw new Error("verifierId must be a field element string");
  const db = new DatabaseSync(dbPath);
  db.exec(`CREATE TABLE IF NOT EXISTS receipts (
    nullifier TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL,
    merchant TEXT NOT NULL,
    min_amount TEXT NOT NULL,
    accepted_at INTEGER NOT NULL
  ) STRICT`);
  const insert = db.prepare("INSERT INTO receipts VALUES (?, ?, ?, ?, ?)");

  const app = Fastify({ logger, bodyLimit: 16 * 1024 });
  app.register(require("@fastify/rate-limit"), { max: 60, timeWindow: "1 minute" });

  app.get("/healthz", async () => ({ ok: true }));

  app.post("/verify-receipt", async (req, reply) => {
    const { proof, publicSignals } = req.body ?? {};
    // publicSignals = [root, invoiceId, merchant, minAmount, verifierId, receiptNullifier]
    if (!validProof(proof) || !Array.isArray(publicSignals) || publicSignals.length !== 6 || !publicSignals.every(isField)) {
      return reply.code(400).send({ ok: false, error: "malformed" });
    }
    const [root, invoiceId, merchant, minAmount, vid, nullifier] = publicSignals;
    if (vid !== verifierId) return reply.code(422).send({ ok: false, error: "wrong_verifier" });
    if (!(await isKnownRoot(BigInt(root)))) return reply.code(422).send({ ok: false, error: "unknown_root" });
    if (!(await snarkjs.groth16.verify(vkey, publicSignals, proof))) {
      return reply.code(422).send({ ok: false, error: "bad_proof" });
    }
    try {
      // PRIMARY KEY makes check-and-record atomic: concurrent replays cannot both win.
      insert.run(nullifier, invoiceId, merchant, minAmount, Math.floor(Date.now() / 1000));
    } catch (e) {
      if (/UNIQUE|constraint/i.test(String(e.message))) return reply.code(409).send({ ok: false, error: "replayed" });
      throw e;
    }
    return { ok: true, invoiceId, merchant, minAmount };
  });

  app.addHook("onClose", async () => db.close());
  return app;
}

module.exports = { createVerifierApp };
