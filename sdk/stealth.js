"use strict";
// ERC-5564-style stealth addresses on secp256k1 (scheme-1 idea, see decisions.md D8).
//   meta-address  = (S = s*G, V = v*G)           published by the merchant
//   payer         : r random, R = r*G, shared = r*V, h = keccak(shared)
//                   stealth pubkey P = S + h*G, viewTag = first byte of h
//   merchant scan : shared = v*R -> same h; stealth privkey = s + h (mod n)
const { secp256k1 } = require("@noble/curves/secp256k1");
const { keccak256, computeAddress, hexlify, getBytes, Wallet, toBeHex } = require("ethers");

const N = secp256k1.CURVE.n;
const Point = secp256k1.ProjectivePoint;
const toNum = (bytes) => BigInt(hexlify(bytes));
const hex32 = (n) => toBeHex(n, 32);

function newMetaKeys() {
  const spend = secp256k1.utils.randomPrivateKey();
  const view = secp256k1.utils.randomPrivateKey();
  return {
    spendKey: hexlify(spend),
    viewKey: hexlify(view),
    meta: {
      S: hexlify(secp256k1.getPublicKey(spend, true)),
      V: hexlify(secp256k1.getPublicKey(view, true)),
    },
  };
}

function sharedHash(sharedPoint) {
  const h = keccak256(sharedPoint.toRawBytes(true));
  return { h, hNum: BigInt(h) % N, viewTag: "0x" + h.slice(2, 4) };
}

/** Payer side: derive a fresh one-time address for the merchant. */
function deriveStealthAddress(meta) {
  const r = secp256k1.utils.randomPrivateKey();
  const R = secp256k1.getPublicKey(r, true);
  const shared = Point.fromHex(getBytes(meta.V)).multiply(toNum(r));
  const { hNum, viewTag } = sharedHash(shared);
  const P = Point.fromHex(getBytes(meta.S)).add(Point.BASE.multiply(hNum));
  return {
    address: computeAddress("0x" + P.toHex(false)),
    viewTag,
    ephemeralPubKey: hexlify(R),
  };
}

/** Merchant side: check an announcement; returns the spending Wallet if it is ours. */
function recoverStealthKey({ spendKey, viewKey }, { ephemeralPubKey, viewTag, address }, provider) {
  const shared = Point.fromHex(getBytes(ephemeralPubKey)).multiply(BigInt(viewKey));
  const h = sharedHash(shared);
  if (h.viewTag !== viewTag) return null; // cheap reject (1/256 false positives)
  const priv = (BigInt(spendKey) + h.hNum) % N;
  const w = new Wallet(hex32(priv), provider);
  return w.address.toLowerCase() === address.toLowerCase() ? w : null;
}

module.exports = { newMetaKeys, deriveStealthAddress, recoverStealthKey };
