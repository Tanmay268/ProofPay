"use strict";
// Fee-bound relayer. The payer proves with `relayer = <this address>` and
// `fee >= minFee`; the relayer submits the tx, so the payer's own wallet never
// appears on-chain. The proof binds the relayer address and fee, so the
// relayer cannot redirect the payment or take more than the agreed fee.
const Fastify = require("fastify");

const DEC = /^[0-9]{1,78}$/;
const ADDR = /^0x[0-9a-fA-F]{40}$/;
const HEX = /^0x[0-9a-fA-F]*$/;
const dec = (s) => typeof s === "string" && DEC.test(s);
const pair = (p) => Array.isArray(p) && p.length === 2 && p.every(dec);

function parse(body) {
  const b = body ?? {};
  const ok =
    pair(b.a) && Array.isArray(b.b) && b.b.length === 2 && b.b.every(pair) && pair(b.c) &&
    ["root", "nullifier", "amount", "invoiceId", "fee", "changeCommitment", "recordCommitment"].every((k) => dec(b[k])) &&
    typeof b.merchant === "string" && ADDR.test(b.merchant) &&
    (b.stealth === undefined ||
      (typeof b.stealth.viewTag === "string" && /^0x[0-9a-fA-F]{2}$/.test(b.stealth.viewTag) &&
        typeof b.stealth.ephemeralPubKey === "string" && HEX.test(b.stealth.ephemeralPubKey) && b.stealth.ephemeralPubKey.length <= 134));
  return ok ? b : null;
}

/**
 * @param opts.pool    ethers Contract connected to the relayer's Wallet
 * @param opts.minFee  bigint, wei
 */
function createRelayerApp({ pool, minFee, logger = false }) {
  const app = Fastify({ logger, bodyLimit: 16 * 1024 });
  app.register(require("@fastify/rate-limit"), { max: 30, timeWindow: "1 minute" });

  app.get("/info", async () => ({ address: await pool.runner.getAddress(), minFee: minFee.toString() }));

  app.post("/relay", async (req, reply) => {
    const b = parse(req.body);
    if (!b) return reply.code(400).send({ ok: false, error: "malformed" });
    const fee = BigInt(b.fee);
    if (fee < minFee) return reply.code(422).send({ ok: false, error: "fee_too_low" });

    const stealth = b.stealth ?? { viewTag: "0x00", ephemeralPubKey: "0x" };
    const args = [b.a, b.b, b.c, b.root, b.nullifier, b.amount, b.invoiceId, b.merchant, b.fee, b.changeCommitment, b.recordCommitment, stealth];
    let gas;
    try {
      gas = await pool.pay.estimateGas(...args); // reverts if the proof/root/nullifier is bad: no gas wasted
    } catch (e) {
      return reply.code(422).send({ ok: false, error: "would_revert", detail: e.shortMessage ?? "revert" });
    }
    const feeData = await pool.runner.provider.getFeeData();
    const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice ?? 0n;
    if (gas * gasPrice > fee) return reply.code(422).send({ ok: false, error: "fee_below_gas_cost" });

    const tx = await pool.pay(...args, { gasLimit: (gas * 12n) / 10n });
    const rc = await tx.wait();
    return { ok: true, txHash: rc.hash, gasUsed: rc.gasUsed.toString() };
  });

  return app;
}

module.exports = { createRelayerApp };
