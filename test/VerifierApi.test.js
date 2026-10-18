const { expect } = require("chai");
const sdk = require("../sdk");
const { createVerifierApp } = require("../services/verifier-api/app");

const E = (s) => BigInt(Math.round(Number(s) * 1e18));

describe("verifier-api", function () {
  let proofData, tree, app;
  const VERIFIER = 42n;

  before(async () => {
    await sdk.init();
    // standalone tree: a note, then a payment record, no chain needed to test the service
    tree = new sdk.MerkleTree();
    const note = sdk.newNote(E("1"));
    note.index = tree.insert(note.commitment);
    const built = sdk.buildPayInput(tree, note, E("0.5"), 99n, "0x00000000000000000000000000000000000000aa");
    tree.insert(built.changeNote.commitment);
    const recordIndex = tree.insert(built.payment.recordCommitment);
    const rin = sdk.buildReceiptInput(tree, built.payment, recordIndex, E("0.5"), VERIFIER);
    proofData = await sdk.proveReceipt(rin);
    app = createVerifierApp({
      vkey: require("../build/receipt_vkey.json"),
      verifierId: VERIFIER.toString(),
      isKnownRoot: async (r) => r === tree.root,
    });
  });
  after(() => app.close());

  const post = (body) => app.inject({ method: "POST", url: "/verify-receipt", payload: body });

  it("accepts a valid receipt once and rejects the replay", async () => {
    const r1 = await post(proofData);
    expect(r1.statusCode).to.equal(200);
    expect(r1.json().ok).to.equal(true);
    const r2 = await post(proofData);
    expect(r2.statusCode).to.equal(409);
    expect(r2.json().error).to.equal("replayed");
  });

  it("rejects malformed, wrong-verifier, unknown-root and tampered inputs", async () => {
    expect((await post({})).statusCode).to.equal(400);
    expect((await post({ proof: proofData.proof, publicSignals: ["1"] })).statusCode).to.equal(400);

    const other = createVerifierApp({
      vkey: require("../build/receipt_vkey.json"),
      verifierId: "43",
      isKnownRoot: async () => true,
    });
    expect((await other.inject({ method: "POST", url: "/verify-receipt", payload: proofData })).json().error).to.equal("wrong_verifier");
    await other.close();

    const stale = createVerifierApp({
      vkey: require("../build/receipt_vkey.json"),
      verifierId: VERIFIER.toString(),
      isKnownRoot: async () => false,
    });
    expect((await stale.inject({ method: "POST", url: "/verify-receipt", payload: proofData })).json().error).to.equal("unknown_root");
    await stale.close();

    const fresh = createVerifierApp({
      vkey: require("../build/receipt_vkey.json"),
      verifierId: VERIFIER.toString(),
      isKnownRoot: async () => true,
    });
    const tampered = { proof: proofData.proof, publicSignals: [...proofData.publicSignals] };
    tampered.publicSignals[3] = E("0.9").toString(); // claim a higher amount
    expect((await fresh.inject({ method: "POST", url: "/verify-receipt", payload: tampered })).json().error).to.equal("bad_proof");
    await fresh.close();
  });
});
