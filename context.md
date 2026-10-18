# Context (living document)

Purpose: one place that says what this project is, what state it is in, and what constraints apply. Update on every meaningful change.

## Goal
Privacy-preserving cryptocurrency payment verification: prove an invoice was paid without revealing the payer, with replay-proof verifier-scoped receipts and opt-in compliance.

## Constraints (from the owner)
- **Zero cost.** Only free tools and free tiers: local Hardhat chain, free GitHub Actions, optional Sepolia with faucet ETH. No paid RPC, hosting, audit or API.
- Decisions are delegated to the maintainer (Claude); each is logged in `decisions.md`.
- Student/research project; testnet only.
- Keep `architecture.md`, `decisions.md` and this file current; diagrams in Mermaid.

## Current state (2026-10-14)
| Area | Status |
|---|---|
| Circuits: pay (with relayer fee), receipt | done, tested |
| ShieldedPool, PayVerifier, BlocklistPolicy | done, tested |
| SDK (notes, tree, proving, stealth, compliance, wallet glue, RootCache) | done, tested |
| Verifier API (replay-proof, query-private roots) | done, tested |
| Relayer (fee-bound) | done, tested |
| Stealth recipients (ERC-5564-style) | done, tested |
| Compliance v1 (deposit blocklist, one-payment disclosure) | done, tested |
| Demo web UI + one-command orchestrator + API smoke test | done, smoke test passes |
| Benchmarks (`npm run bench`), randomized invariant test | done |
| CI workflow (free GitHub Actions) | written, never run on GitHub |
| Multi-party trusted setup, external audit, formal proofs | not achievable at zero cost; documented in `docs/` |
| ASP-in-circuit compliance, in-browser proving, PIR, ERC-20 | future work |

## Test status
`npm test`: 13 passing (Pool, Relayer, VerifierApi). `npm run demo` + `npm run demo:smoke`: 13/13 checks pass.

## Environment
Windows 11, Node 22.16, Hardhat 2, circom 2.2.3 (pinned binary), snarkjs 0.7, circomlibjs 0.1.7, ethers 6, Fastify 5.

## Where things are
`architecture.md` (system, diagrams), `decisions.md` (why), `README.md` (setup, demo script), `docs/SECURITY.md` (limits), `IMPLEMENTATION_PLAN.md` one level up (original plan and references).
