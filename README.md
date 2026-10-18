# ProofPay

Privacy-preserving cryptocurrency payment verification. A payer pays an invoice from a shielded pool; the merchant, and later any third-party verifier, learns **that the invoice was paid, not who paid it**. Receipts are unlinkable, single-use per verifier, and can be audited one payment at a time.

> **Status: research prototype, unaudited, testnet only, costs nothing to run.** Read [docs/SECURITY.md](docs/SECURITY.md) before relying on it.

Docs: [architecture.md](architecture.md) · [decisions.md](decisions.md) · [context.md](context.md) · [docs/SECURITY.md](docs/SECURITY.md) · [docs/CEREMONY.md](docs/CEREMONY.md)

## What is in the box
| Feature | Where |
|---|---|
| Shielded pool, invoice-bound payments, change notes | `contracts/ShieldedPool.sol`, `circuits/pay.circom` |
| Unlinkable, verifier-scoped, single-use receipts | `circuits/receipt.circom`, `services/verifier-api` |
| Fee-bound relayer (payer's wallet never on-chain) | `services/relayer` |
| Stealth one-time recipient address per payment | `sdk/stealth.js` |
| Query-private verification (local root cache) | `sdk/chain.js` (`RootCache`) |
| Compliance v1: deposit blocklist + single-payment disclosure | `contracts/BlocklistPolicy.sol`, `sdk/compliance.js` |
| Browser demo of all four roles | `services/demo`, `npm run demo` |

## Setup (about 5 minutes, free)
Requirements: **Node.js 22.5 or newer** and Git. No Docker, no accounts, no API keys, no paid services.

```bash
cd ProofPay
npm ci                  # install dependencies
npm run fetch:circom    # download pinned, checksum-verified circom 2.2.3
npm run setup           # compile circuits + development trusted setup (about 1 minute)
npm run compile         # compile Solidity
npm test                # 13 tests: contracts, circuits, SDK, relayer, verifier
```
If `npm test` shows `13 passing`, everything works. (Lines starting with `ERROR: ... Error in template` are expected: they are the circuits correctly rejecting forged inputs in negative tests.)

## Run the demo
```bash
npm run demo            # starts local chain + deploys + relayer + verifier + UI
```
Open **http://127.0.0.1:3000**. Stop with Ctrl+C. To self-check the whole story headlessly, run `npm run demo:smoke` in a second terminal (expects 13 PASS lines).

### Demo script (about 5 minutes)
1. **Merchant panel:** click *Create invoice* (0.25 ETH, "Coffee order #42").
2. **Payer panel:** click *Deposit into pool* (1 ETH). The note appears in the list.
3. Choose the invoice, the note, and *Relayer*, then click **Prove and pay**. Wait a few seconds while the proof is generated.
4. **Look at the "What a blockchain observer sees" table.** The deposit shows the payer's wallet. The payment shows the *relayer* as sender and a one-time address as recipient. Nothing links the two. This is the privacy claim.
5. **Merchant panel:** click *Scan for payments* (the invoice turns "paid" using only the merchant's viewing key), then *Sweep to main wallet*.
6. **Verifier panel:** choose the payment, *Generate receipt proof*, then *Submit to verifier*. It is accepted without learning who paid.
7. Click *Submit again (replay)*. It is **rejected** (single use per verifier).
8. **Compliance panel:** click *Block payer's address*, then try *Deposit into pool* again; it reverts. Click *Unblock*. Then *Disclose to auditor*: one payment is proven to the auditor and nothing else.
9. Optional contrast: pay a second invoice with *My own wallet*; the observer table now shows your wallet as the sender (what you lose by not using a relayer).

### Talking points
- **Problem:** a normal on-chain payment proof ("here is my tx hash") leaks the payer's wallet history and can be shared or replayed.
- **Idea:** a zero-knowledge proof of "a payment of at least X for invoice I to merchant M exists", bound to one verifier.
- **Novelty:** invoice-bound receipt proofs with verifier-scoped nullifiers, plus a verifier that checks them without per-receipt chain queries, plus opt-in compliance.
- **Honest limits:** see [docs/SECURITY.md](docs/SECURITY.md) (public amounts, dev-only trusted setup, small anonymity set, unaudited).

## Other commands
| Command | What it does |
|---|---|
| `npm run bench` | proving time, verification time, gas (writes `docs/bench-latest.json`) |
| `npm run node` | standalone local chain on :8545 |
| `npx hardhat run scripts/deploy.js --network localhost` | deploy to a running local node |
| `RPC_URL=... POOL_ADDRESS=0x... VERIFIER_ID=<n> npm run verifier` | run a standalone receipt verifier |

### Optional: free public testnet (Sepolia)
Get free test ETH from any Sepolia faucet and a free public RPC URL, then:
```bash
export SEPOLIA_RPC_URL=<free rpc url> DEPLOYER_KEY=<throwaway test key>   # PowerShell: $env:SEPOLIA_RPC_URL=...
npx hardhat run scripts/deploy.js --network sepolia
```
Use a throwaway key that has never held real funds. Gas is about 1.1–1.7M per payment, so you need a few hundredths of a test ETH.

## Measured (my machine: Windows, 16 CPUs, Node 22)
| Metric | Value |
|---|---|
| Constraints (non-linear) | pay about 6.9k, receipt about 5.8k |
| Pay proof generation | about 1.6 s mean (0.9 s best) |
| Receipt proof generation | about 0.85 s |
| Receipt verification | about 29 ms |
| Proof size | 3 group elements (about 650 bytes as JSON) |
| `pay()` gas | about 1.07M when the tree index is even, about 1.72M when odd (see decision D14) |
| `deposit()` gas | about 0.84M |

## Troubleshooting
- *`circom` missing*: run `npm run fetch:circom` (it verifies a SHA-256 before installing).
- *Port in use*: the demo needs 3000, 8545, 8787, 8788 free.
- *SQLite experimental warning*: harmless (`node:sqlite`).
- *`build/` or `contracts/generated` missing*: run `npm run setup`.
