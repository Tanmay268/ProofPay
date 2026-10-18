# Trusted setup

`npm run setup` performs a **development** Groth16 setup:
Powers of Tau (2^15, one local contribution) → circuit-specific phase 2 (one local contribution).
Anyone with access to that machine's entropy could forge proofs, so these keys are for local and testnet use only.

## Production procedure (to be run before any real-value deployment)
1. Start from a public, multi-contributor Powers of Tau file with ≥ 2^15 capacity (e.g. the Hermez/PSE ptau), and verify it with `snarkjs powersoftau verify`.
2. Compile circuits from a tagged release; record the SHA-256 of each `.r1cs`.
3. `snarkjs groth16 setup` → `*_0000.zkey`.
4. Collect ≥ 10 independent contributions with `snarkjs zkey contribute`; each contributor publishes their attestation hash.
5. Apply a public random beacon (`snarkjs zkey beacon`) using a future block hash announced in advance.
6. `snarkjs zkey verify` against the r1cs and ptau; publish transcript and final SHA-256.
7. Export the verification key and Solidity verifier from the final zkey; commit `contracts/generated/PayVerifier.sol` and the vkey JSON; deploy.
8. Reproducibility check by a third party: recompile, verify r1cs hash, verify zkey.

Alternative: migrate to a transparent system (STARK/Halo2/Nova) and drop the ceremony; see the plan's PLONK/Halo2 stretch goal.
