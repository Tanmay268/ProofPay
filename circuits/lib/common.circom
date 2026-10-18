pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/comparators.circom";

// Domain-separation tags. Every Poseidon use in the protocol starts with one
// of these so that a hash computed for one purpose can never be reinterpreted
// as another (e.g. a note commitment as a nullifier).
function TAG_NOTE()    { return 1; }
function TAG_OWNER()   { return 2; }
function TAG_NULL()    { return 3; }
function TAG_RECORD()  { return 4; }
function TAG_RECEIPT() { return 5; }

// Amounts are range-checked to 96 bits so that sums can never wrap the field.
function AMOUNT_BITS() { return 96; }

// ownerCommit = Poseidon(TAG_OWNER, secret)
template OwnerCommit() {
    signal input secret;
    signal output out;
    component h = Poseidon(2);
    h.inputs[0] <== TAG_OWNER();
    h.inputs[1] <== secret;
    out <== h.out;
}

// note = Poseidon(TAG_NOTE, value, ownerCommit)
// The pool contract recomputes this on deposit from msg.value, so a depositor
// cannot commit to a larger value than they paid in.
template NoteCommit() {
    signal input value;
    signal input secret;
    signal output out;
    component oc = OwnerCommit();
    oc.secret <== secret;
    component h = Poseidon(3);
    h.inputs[0] <== TAG_NOTE();
    h.inputs[1] <== value;
    h.inputs[2] <== oc.out;
    out <== h.out;
}

// Binary Poseidon Merkle path. pathIndices[i] == 1 means the running node is
// the RIGHT child at level i (matches the on-chain incremental tree).
template MerkleRoot(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output root;

    signal nodes[depth + 1];
    signal diff[depth];
    signal left[depth];
    signal right[depth];
    component hashers[depth];

    nodes[0] <== leaf;
    for (var i = 0; i < depth; i++) {
        pathIndices[i] * (1 - pathIndices[i]) === 0;
        diff[i] <== pathElements[i] - nodes[i];
        left[i] <== nodes[i] + pathIndices[i] * diff[i];
        right[i] <== pathElements[i] - pathIndices[i] * diff[i];
        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== left[i];
        hashers[i].inputs[1] <== right[i];
        nodes[i + 1] <== hashers[i].out;
    }
    root <== nodes[depth];
}

// Leaf index implied by the path bits (little-endian).
template PathToIndex(depth) {
    signal input pathIndices[depth];
    signal output index;
    var acc = 0;
    var pow = 1;
    for (var i = 0; i < depth; i++) {
        acc += pathIndices[i] * pow;
        pow = pow + pow;
    }
    index <== acc;
}
