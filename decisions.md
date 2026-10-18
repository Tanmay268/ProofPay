# Decision log

Format: ID, decision, why, alternatives, consequence. Newest at the bottom.

## D1. Zero-cost stack
**Decision:** local Hardhat chain for dev/demo; Sepolia + faucet ETH optional; GitHub Actions free tier for CI; no paid services anywhere.
**Why:** hard constraint from the owner. **Alternatives:** paid RPC (Alchemy/Infura paid tiers), cloud hosting. **Consequence:** no mainnet, no external audit, no hosted demo; everything runs on a laptop.

## D2. Groth16 with Circom/snarkjs
**Why:** smallest proofs, cheapest on-chain verification, fully free tooling, mature. **Alternatives:** PLONK (no per-circuit setup, bigger proofs/gas), Halo2/Noir (steeper toolchain), STARKs (large proofs). **Consequence:** needs a trusted setup; dev-only single contribution (see `docs/CEREMONY.md`).

## D3. EVM + native currency, one pool
**Why:** simplest free test environment; asset id adds circuit complexity without research value. **Consequence:** ETH only; ERC-20 is future work.

## D4. Poseidon Merkle tree depth 20, domain-separated tags
**Why:** cheap in-circuit hashing; ~1M leaves; tags prevent cross-purpose hash reuse. **Consequence:** on-chain Poseidon makes `pay()` gas-heavy (~1.7M); acceptable for L2/testnet.

## D5. Contract binds `msg.value` into the note
**Why:** otherwise a depositor could commit to any value. Note = `Poseidon(TAG, value, Poseidon(TAG_OWNER, secret))` so the contract can compute it without learning the secret.

## D6. Payment record leaf + verifier-scoped receipt nullifier (core novelty)
**Why:** lets a payer prove payment later, off-chain, unlinkably, once per verifier. **Alternative:** reveal tx hash (linkable, transferable, replayable).

## D7. Fee-bound relayer in the pay circuit
**Decision:** add `relayer` and `fee` public inputs; `value = pay + fee + change`.
**Why:** payer should not need to submit (and be linked by) the on-chain tx; binding the fee stops a relayer from skimming or swapping the recipient.

## D8. Stealth recipients, ERC-5564-style on secp256k1
**Why:** merchant address is otherwise public and reusable; stealth gives a fresh address per invoice. **Simplification:** implemented in the SDK with ethers primitives following the scheme-1 idea (ECDH shared secret, view tag); not claimed to be a fully ERC-5564-conformant implementation.

## D9. Compliance v1 = deposit screening hook + payment disclosure; ASP-in-circuit deferred
**Why:** Privacy-Pools-style association proofs need lineage handling for change notes and a new circuit/setup; too large and risky for this scope. **What ships:** an owner-set `IDepositPolicy` (blocklist) checked at deposit, and a "disclosure" a payer can hand to an auditor to prove one specific payment (reveals that payment only). **Consequence:** documented as partial; do not call the system compliant.

## D10. Query-private verification via local root cache
**Decision:** the verifier downloads all pool root events and checks roots locally instead of asking an RPC "is this root known?".
**Why:** zero-cost and removes per-receipt query leakage to the RPC; PIR is research-grade and expensive. **Consequence:** the verifier still learns what the payer shows it (by design); the RPC only sees an undifferentiated log sync.

## D11. Demo UI is a thin web page over a local "wallet daemon"
**Why:** in-browser proving needs bundling circomlibjs/snarkjs/WASM and is slow to get right; the daemon keeps the project single-command and free. **Consequence:** secrets live in the local daemon, not the browser; labelled as a demo, and the SDK is the real client library.

## D12. SQLite (node:sqlite) for verifier state
**Why:** zero install, free, atomic primary-key replay protection. **Consequence:** Node ≥ 22.5; experimental-warning noise.

## D13. Plain JavaScript (CommonJS) rather than TypeScript
**Why:** fewer moving parts with Hardhat 2 + snarkjs; JSDoc where useful. **Consequence:** less static checking.

## D14. Pair-insert for change + record leaves
**Why:** halves hashing when the tree index is even (≈1.07M gas vs ≈1.72M when the index is odd and two single inserts are needed). **Consequence:** pay gas depends on tree parity; documented in benchmarks. Making all inserts pair-aligned (e.g. padding deposits) was rejected as it wastes gas on deposits.

## D15. Relayer address = `msg.sender`, enforced by the contract
**Why:** the contract passes `msg.sender` as the proof's `relayer` input, so only the intended submitter can collect the fee and nobody can front-run a relayed proof. **Alternative:** relayer as a calldata parameter (allows signature-less front-running by changing it to themselves if unbound). **Consequence:** self-submitting payers must prove with their own address, which reveals them.

## D16. Receipt verification is off-chain
**Why:** receipts are for third parties who are not on-chain; an on-chain verifier would cost gas and publish the receipt. **Consequence:** replay protection is each verifier's own database.

## D17. Compliance disclosure reveals paySecret
**Why:** simplest sound mechanism: the auditor recomputes the record commitment and finds it in public logs. **Consequence:** the auditor can later produce receipts for that payment; share only with trusted auditors.

## D18. Pinned, checksum-verified circom binary
**Why:** the npm WASM build of circom failed to write outputs on Windows; the official release binary is free and reproducible. **Consequence:** `scripts/fetch-circom.js` pins version and SHA-256 per platform.

## D19. No automatic git commits
The repository is initialised but nothing is committed until the owner asks.
