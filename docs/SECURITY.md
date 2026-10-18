# Security model, status and known limitations

**Status: research prototype. Unaudited. Testnet only. Do not deposit real value.**

## What is protected (and the property tests that check it)
| Property | Mechanism | Test |
|---|---|---|
| Note value equals what was paid in | Contract recomputes `Poseidon(TAG_NOTE, msg.value, ownerCommit)` on deposit | `depositNote` asserts commitment equality |
| No double spend | Nullifier `Poseidon(TAG_NULL, secret, leafIndex)` stored on-chain | "rejects double spend" |
| Payment cannot be redirected by a front-runner | `merchant`, `invoiceId`, `payAmount`, change and record commitments are public inputs | "wrong recipient" → `InvalidProof` |
| No inflation / overspend | `value == pay + change`, all 96-bit range-checked | "overspend" witness failure |
| Receipt cannot claim more than paid | `payAmount >= minAmount` in-circuit | "cannot be forged for an unpaid amount" |
| Receipt cannot be replayed to the same or another verifier | `receiptNullifier` scoped to `verifierId`; verifier DB primary key | verifier-api tests |
| Cross-purpose hash confusion | Domain-separation tags on every Poseidon use | by construction, see `circuits/lib/common.circom` |

## Known limitations (read before using)
1. **Trusted setup is a single local contribution.** Whoever ran `npm run setup` can forge proofs. See `CEREMONY.md`.
2. **Amounts are public at deposit and at payment.** A deposit of exactly the payment amount is trivially linkable. Mitigation (not yet implemented): fixed denominations, forced change, or in-circuit deposit splitting. Anonymity set is just the number of unspent notes.
3. **Timing and balance correlation** between a deposit and a payment can deanonymize low-volume pools.
4. **Self-submitting links you.** If you call `pay()` from the wallet that deposited, you are linked. Use the relayer (implemented; the proof binds relayer address and fee). A relayer sees your IP and proof, so use Tor or a trusted relayer for real privacy.
5. **Stealth addresses hide the recipient, not the amount.** Merchant payouts use a fresh one-time address per payment (ERC-5564-style, not a conformance-tested implementation). Sweeping later from one-time addresses can re-link them if gas is funded from one wallet.
6. **Verifier API learns `(invoiceId, merchant, minAmount)`** by design. Roots are checked against a local copy of the public RootAdded log, so the RPC provider does not see which receipts are checked, only a bulk log sync. Full PIR is not implemented.
7. **Owner can pause** the pool (including payments). Use a multisig and timelock; deployer-as-owner is for testnet only.
8. **Compliance is partial.** Implemented: owner-curated deposit blocklist and per-payment disclosure. Not implemented: association-set (ASP) membership proofs in the circuit. A disclosure reveals that payment's `paySecret`, so the auditor could later produce receipts for it. Do not describe the system as regulator-approved or compliant.
9. **Gas:** `pay()` costs about 1.07M gas (even tree index) to 1.72M (odd) because Poseidon is hashed on-chain. Intended for L2 or testnet.
10. **Legal:** shielded pools have attracted sanctions enforcement. Get legal advice before any public deployment.

## Before any real-value use
- Multi-party trusted setup with public transcript (or switch to a transparent proof system).
- Independent audit of circuits (under-constrained signal analysis) and contracts.
- Longer fuzz/invariant campaigns (a short randomized solvency test exists; run Echidna or Foundry invariants for depth).
- Formal write-up of the security definitions listed in the plan.
- Key management and monitoring for the owner and verifier services.

## Reporting
Open a private security advisory on the repository, or email the maintainer. Do not file public issues for vulnerabilities.
