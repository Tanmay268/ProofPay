pragma circom 2.1.6;

include "lib/common.circom";

// PayInvoice: spend one shielded note to pay `payAmount` to `merchant` for
// `invoiceId`, returning the remainder to a fresh change note and inserting a
// hidden payment record that can later be turned into receipts.
//
// Public: root, nullifier, payAmount, invoiceId, merchant, relayer, fee,
//         changeCommitment, recordCommitment
template PayInvoice(depth) {
    // ---- public ----
    signal input root;
    signal input nullifier;
    signal input payAmount;
    signal input invoiceId;
    signal input merchant;          // recipient address as a field element
    signal input relayer;           // the only address allowed to submit this proof and collect `fee`
    signal input fee;
    signal input changeCommitment;
    signal input recordCommitment;

    // ---- private ----
    signal input value;
    signal input secret;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal input changeValue;
    signal input changeSecret;
    signal input paySecret;

    // range checks (also prevent wrap-around in value == pay + change)
    component rValue = Num2Bits(AMOUNT_BITS());   rValue.in <== value;
    component rPay = Num2Bits(AMOUNT_BITS());     rPay.in <== payAmount;
    component rChange = Num2Bits(AMOUNT_BITS());  rChange.in <== changeValue;
    component rFee = Num2Bits(AMOUNT_BITS());     rFee.in <== fee;
    value === payAmount + fee + changeValue;

    // Force `relayer` into the constraint system so it can never be optimised
    // away; it is bound to the proof through the public-input vector.
    signal relayerSquare;
    relayerSquare <== relayer * relayer;

    // note is in the tree
    component note = NoteCommit();
    note.value <== value;
    note.secret <== secret;
    component tree = MerkleRoot(depth);
    tree.leaf <== note.out;
    for (var i = 0; i < depth; i++) {
        tree.pathElements[i] <== pathElements[i];
        tree.pathIndices[i] <== pathIndices[i];
    }
    tree.root === root;

    // nullifier is bound to the note's position, so it is unique per note
    component idx = PathToIndex(depth);
    for (var i = 0; i < depth; i++) { idx.pathIndices[i] <== pathIndices[i]; }
    component nf = Poseidon(3);
    nf.inputs[0] <== TAG_NULL();
    nf.inputs[1] <== secret;
    nf.inputs[2] <== idx.index;
    nf.out === nullifier;

    // change note
    component change = NoteCommit();
    change.value <== changeValue;
    change.secret <== changeSecret;
    change.out === changeCommitment;

    // payment record (hidden preimage; paySecret is the receipt key)
    component rec = Poseidon(5);
    rec.inputs[0] <== TAG_RECORD();
    rec.inputs[1] <== invoiceId;
    rec.inputs[2] <== merchant;
    rec.inputs[3] <== payAmount;
    rec.inputs[4] <== paySecret;
    rec.out === recordCommitment;
}

component main {public [root, nullifier, payAmount, invoiceId, merchant, relayer, fee, changeCommitment, recordCommitment]} = PayInvoice(20);
