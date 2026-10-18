pragma circom 2.1.6;

include "lib/common.circom";

// ProveReceipt: show a verifier that a payment record for (invoiceId, merchant)
// with amount >= minAmount exists in the pool, without revealing which one.
// receiptNullifier is scoped to verifierId so a receipt cannot be replayed to
// a different verifier, and a single verifier can reject a re-shown receipt.
//
// Public: root, invoiceId, merchant, minAmount, verifierId, receiptNullifier
template ProveReceipt(depth) {
    signal input root;
    signal input invoiceId;
    signal input merchant;
    signal input minAmount;
    signal input verifierId;
    signal input receiptNullifier;

    signal input payAmount;
    signal input paySecret;
    signal input pathElements[depth];
    signal input pathIndices[depth];

    component rPay = Num2Bits(AMOUNT_BITS());   rPay.in <== payAmount;
    component rMin = Num2Bits(AMOUNT_BITS());   rMin.in <== minAmount;
    component ge = GreaterEqThan(AMOUNT_BITS());
    ge.in[0] <== payAmount;
    ge.in[1] <== minAmount;
    ge.out === 1;

    component rec = Poseidon(5);
    rec.inputs[0] <== TAG_RECORD();
    rec.inputs[1] <== invoiceId;
    rec.inputs[2] <== merchant;
    rec.inputs[3] <== payAmount;
    rec.inputs[4] <== paySecret;

    component tree = MerkleRoot(depth);
    tree.leaf <== rec.out;
    for (var i = 0; i < depth; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }
    tree.root === root;

    component rn = Poseidon(4);
    rn.inputs[0] <== TAG_RECEIPT();
    rn.inputs[1] <== paySecret;
    rn.inputs[2] <== invoiceId;
    rn.inputs[3] <== verifierId;
    rn.out === receiptNullifier;
}

component main {public [root, invoiceId, merchant, minAmount, verifierId, receiptNullifier]} = ProveReceipt(20);
