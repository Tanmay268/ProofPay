# Architecture

## 1. System overview
```mermaid
flowchart LR
  subgraph Client["Payer side (sdk/)"]
    W[Wallet helpers<br/>sdk/wallet.js]
    P[Prover<br/>snarkjs + circuits]
    T[Merkle replica<br/>sdk/index.js]
    S[Stealth derive<br/>sdk/stealth.js]
  end
  subgraph Chain["EVM chain (local Hardhat or Sepolia)"]
    SP[ShieldedPool.sol<br/>Poseidon tree, nullifiers]
    V[PayVerifier.sol<br/>Groth16]
    BP[BlocklistPolicy.sol]
    PO[Poseidon2 / Poseidon3]
  end
  subgraph Services["Off-chain services (Node, free)"]
    R[Relayer<br/>services/relayer]
    VA[Verifier API<br/>services/verifier-api]
    RC[(RootCache<br/>local root ring)]
    DB[(SQLite<br/>receipt nullifiers)]
  end
  M[Merchant<br/>view + spend keys]
  A[Auditor]

  W --> P
  W --> T
  W --> S
  W -- "deposit(ownerCommit)" --> SP
  W -- "pay proof via HTTP" --> R
  R -- "pay(...)" --> SP
  SP --> V
  SP --> PO
  SP -. "deposit screening" .-> BP
  SP -- "RootAdded / Payment / StealthAnnouncement logs" --> RC
  SP -- "logs" --> M
  W -- "receipt proof" --> VA
  VA --> RC
  VA --> DB
  W -- "disclosure (one payment)" --> A
  A -- "recompute + check logs" --> SP
```

## 2. Data model
| Object | Definition |
|---|---|
| ownerCommit | `Poseidon(TAG_OWNER, secret)` |
| note | `Poseidon(TAG_NOTE, value, ownerCommit)`; the contract computes it on deposit from `msg.value` |
| nullifier | `Poseidon(TAG_NULL, secret, leafIndex)` |
| payment record | `Poseidon(TAG_RECORD, invoiceId, merchant, amount, paySecret)`, inserted in the same tree |
| receipt nullifier | `Poseidon(TAG_RECEIPT, paySecret, invoiceId, verifierId)` |

All tags are distinct constants (`circuits/lib/common.circom`), so one hash can never be reused as another.

## 3. Payment sequence
```mermaid
sequenceDiagram
  autonumber
  participant Payer
  participant Merchant
  participant Relayer
  participant Pool as ShieldedPool
  Merchant->>Payer: invoice {id, amount, meta-address (S,V)}
  Payer->>Pool: deposit(ownerCommit) + value
  Pool-->>Payer: Deposit(commitment, leafIndex)
  Payer->>Payer: derive one-time stealth address from (S,V)
  Payer->>Payer: prove PayInvoice (spend note, pay, fee, change, record)
  Payer->>Relayer: proof + public inputs
  Relayer->>Relayer: estimateGas (reject if it would revert), check fee >= gas cost
  Relayer->>Pool: pay(proof, ..., stealth announcement)
  Pool->>Pool: verify proof, mark nullifier, insert change + record leaves
  Pool-->>Merchant: ETH to one-time address
  Pool-->>Merchant: StealthAnnouncement + Payment events
  Merchant->>Merchant: view key finds payment, derives spend key, sweeps
```

## 4. Receipt sequence (the core novelty)
```mermaid
sequenceDiagram
  autonumber
  participant Payer
  participant Verifier as Third-party verifier
  participant Cache as RootCache (local)
  participant DB as Nullifier DB
  Payer->>Payer: prove ProveReceipt(record in tree, amount >= min, verifierId)
  Payer->>Verifier: {proof, root, invoiceId, merchant, minAmount, verifierId, receiptNullifier}
  Verifier->>Verifier: verifierId is mine?
  Verifier->>Cache: root known? (local lookup, no RPC per receipt)
  Verifier->>Verifier: Groth16 verify
  Verifier->>DB: INSERT receiptNullifier (PRIMARY KEY)
  alt first time
    DB-->>Verifier: ok
    Verifier-->>Payer: accepted
  else replay
    DB-->>Verifier: unique violation
    Verifier-->>Payer: 409 replayed
  end
```

## 5. Circuits
```mermaid
flowchart TD
  subgraph PayInvoice
    N[note = Poseidon tag,value,ownerCommit] --> MP[Merkle path -> root]
    NF[nullifier = Poseidon tag,secret,leafIndex]
    EQ[value = pay + fee + change<br/>96-bit range checks]
    CH[change note commitment]
    RE[payment record commitment]
  end
  subgraph ProveReceipt
    RR[record commitment] --> MR[Merkle path -> root]
    GE[amount >= minAmount]
    RN[receiptNullifier scoped to verifierId]
  end
```
Public inputs, pay: `root, nullifier, payAmount, invoiceId, merchant, relayer, fee, changeCommitment, recordCommitment`.
Public inputs, receipt: `root, invoiceId, merchant, minAmount, verifierId, receiptNullifier`.
The contract passes `msg.sender` as `relayer`, which binds who may submit and collect the fee.

## 6. Trust boundaries
```mermaid
flowchart LR
  subgraph Public["Public: anyone can read"]
    L[Chain logs: deposits, payments, nullifiers, roots, announcements]
  end
  subgraph Secret["Payer-only secrets"]
    K[note secrets, paySecret]
  end
  subgraph Partial["Learned by design"]
    VM[Verifier: invoice, merchant, min amount]
    AU[Auditor: ONE disclosed payment]
    MR[Merchant: its own payments via view key]
  end
  K --> Partial
  Public -. "cannot link deposit to payment" .-> Secret
```

## 7. Deployment (all free)
```mermaid
flowchart LR
  dev[Laptop] --> hh[Hardhat node :8545]
  dev --> ui[Demo UI :3000]
  dev --> rel[Relayer :8788]
  dev --> ver[Verifier :8787]
  ui --> rel
  ui --> ver
  rel --> hh
  ver --> hh
  ci[GitHub Actions free tier] -->|npm test + smoke| dev
```
Optional: deploy contracts to Sepolia with faucet ETH and a free public RPC; run the same services against it.

## 8. Directory map
| Path | Purpose |
|---|---|
| `circuits/` | `pay.circom`, `receipt.circom`, `lib/common.circom` |
| `contracts/` | `ShieldedPool.sol`, `BlocklistPolicy.sol`, `generated/PayVerifier.sol` |
| `sdk/` | notes, tree replica, proving, stealth, compliance, chain sync, wallet glue |
| `services/relayer`, `services/verifier-api`, `services/demo` | HTTP services and the demo daemon/UI |
| `scripts/` | setup (ceremony), deploy, demo orchestrator, smoke, bench |
| `test/` | contract, circuit, SDK, service and invariant tests |
| `docs/` | SECURITY, CEREMONY, benchmarks |
