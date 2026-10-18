# ProofPay: Manual Testing Guide

Plain-language, step-by-step checks for every feature. No coding needed for Parts 1-8. Everything runs on your own computer with fake test money, so nothing here costs anything.

**How to read this guide**
- **Do** = what you click or type.
- **Expect** = what you should see. If you see something different, the test failed (see Part 11).
- Sample data is given so you can copy it exactly.

---

## Part 0. One-time setup

Open a terminal in the `ProofPay` folder and run:

```bash
npm ci
npm run fetch:circom
npm run setup        # about 1 minute
npm run compile
```

**Needed:** Node.js 22.5 or newer. Ports 3000, 8545, 8787, 8788 must be free.

## Part 1. Automatic tests (quick sanity check)

**Do:** `npm test`

**Expect:** `13 passing` at the end. Lines that start with `ERROR: ... Error in template` are normal. They are the circuits correctly refusing fake inputs.

What the 13 tests cover, in simple words:

| # | Test | What it proves |
|---|---|---|
| 1 | Off-chain tree matches contract | The app's copy of the payment list is identical to the blockchain's |
| 2 | Deposit, pay, receipt, spend change | The whole happy path works |
| 3 | Receipt can't claim more than paid | Nobody can lie about the amount |
| 4 | Rejects double spend, wrong recipient, wrong submitter, unknown root, fee tampering, overspend | The pool refuses six kinds of cheating |
| 5 | Relayer fee is bound by the proof | The relayer can't change its fee after the fact |
| 6 | Stealth address: merchant finds and sweeps | One-time addresses work end to end |
| 7 | Compliance: blocklist and disclosure | Blocked wallets can't deposit; one payment can be shown to an auditor |
| 8 | Root cache mirrors chain | Local verification cache stays in sync |
| 9 | Random-operations invariants | Money is never created or lost |
| 10 | Admin controls: cap, pause, ownership | Owner tools work and are safe |
| 11 | Relayer service | Accepts good requests, rejects bad ones |
| 12-13 | Verifier API | Accepts a receipt once, rejects replays and junk |

## Part 2. Fast full check (headless)

**Do:** open two terminals.
1. Terminal A: `npm run demo` (wait for "ProofPay demo is running").
2. Terminal B: `npm run demo:smoke`

**Expect:** 13 lines starting with `PASS`, ending with `All smoke checks passed`. Any `FAIL` line names the broken feature.

Leave Terminal A running for Parts 3-8.

---

## Part 3. The browser demo: Merchant and Payer

Open **http://127.0.0.1:3000**. You will see four boxes (Merchant, Payer, Verifier, Compliance), an observer table and a log at the bottom. Watch the **log** after every click; it confirms what happened.

### Test 3.1: Create an invoice
**Sample data:** Amount `0.25`, Memo `Coffee order #42` (already filled in).
**Do:** Merchant box, click **Create invoice**.
**Expect:** a new invoice appears in the Merchant list, and it shows up in the Payer's **Invoice** dropdown.

### Test 3.2: Create a second invoice with different data
**Sample data:** Amount `0.5`, Memo `Pizza #7`.
**Do:** change the two fields, click **Create invoice**.
**Expect:** two invoices in the list, each with a different ID.

### Test 3.3: Deposit into the pool
**Sample data:** Deposit `1` ETH.
**Do:** Payer box, click **Deposit into pool**.
**Expect:** a note worth 1 ETH appears in the notes list and in the **Note to spend** dropdown. Payer balance goes down by about 1 ETH. The observer table gets a *Deposit* row showing the **payer's wallet** as sender (deposits are public; privacy starts after this).

### Test 3.4: Pay through the relayer (the main privacy feature)
**Do:**
1. Invoice = `Coffee order #42`.
2. Note to spend = the 1 ETH note.
3. Mode = **Relayer (hides my wallet, 0.01 ETH fee)**.
4. Click **Prove and pay**. Wait a few seconds for the proof.

**Expect:**
- The log shows proof time (about 1-2 s) and gas used.
- The old 1 ETH note is marked spent. A new **change note** appears (about 0.74 ETH = 1 - 0.25 - 0.01 fee).
- Observer table, *Payment* row: **Sent by = the relayer's address, not the payer's**. Recipient is a one-time address. Nothing connects it to the deposit row.

### Test 3.5: Pay with your own wallet (the contrast)
**Sample data:** Invoice `Pizza #7`, spend the change note from 3.4, Mode = **My own wallet**.
**Expect:** payment works with no fee. Observer table now shows the **payer's own wallet** as sender. This proves the relayer is what hides you.

### Test 3.6: Note too small
**Do:** Deposit `0.1` ETH. Try to pay `Pizza #7` (0.5 ETH) with that note.
**Expect:** error "note too small (needs amount + fee)". No money moves.

### Test 3.7: Spend a used note
**Do:** pick a note already marked spent (if the dropdown still lets you) and pay.
**Expect:** error "unknown invoice or spent note". (The pool also blocks double-spends on-chain; see Part 9.)

### Test 3.8: Bad deposit amount
**Do:** set Deposit to `abc`, click **Deposit into pool**.
**Expect:** error "bad amount". Try `0` too: it should be refused.

## Part 4. Merchant: stealth addresses

### Test 4.1: Scan for payments
**Do:** Merchant box, click **Scan for payments** (after Test 3.4).
**Expect:** log says `1 payment(s) detected with the viewing key`; the invoice turns **paid**. The merchant found it using only a viewing key, without being told anything by the payer.

### Test 4.2: Sweep funds
**Do:** click **Sweep to main wallet**.
**Expect:** log says `Swept 0.25 ETH` (or the total of paid invoices). Merchant balance goes up by about that amount.

### Test 4.3: Sweep twice
**Do:** click **Sweep** again right away.
**Expect:** nothing more to sweep (0 ETH), no error.

### Test 4.4: Each payment uses a new address
**Do:** look at the observer table recipient column for the two payments from 3.4 and 3.5.
**Expect:** the two recipient addresses are **different**, even though the merchant is the same.

## Part 5. Third-party verifier (receipts)

### Test 5.1: Make and submit a receipt
**Do:** Verifier box → **Payment to prove** = the Coffee payment → **Generate receipt proof** → **Submit to verifier**.
**Expect:** proof time about 1 s. The verifier answers **accepted** and shows only invoice ID, merchant and minimum amount. It never shows who paid.

### Test 5.2: Replay is rejected
**Do:** click **Submit again (replay)**.
**Expect:** **rejected**, error `replayed` (HTTP 409). A receipt works once per verifier.

### Test 5.3: A second payment, a second receipt
**Do:** generate a receipt for the Pizza payment and submit.
**Expect:** accepted. Different payments have different receipts.

## Part 6. Compliance

### Test 6.1: Block a wallet
**Do:** Compliance box → **Block payer's address**.
**Expect:** log confirms payer blocked.

### Test 6.2: Blocked wallet cannot deposit
**Do:** Payer box → **Deposit into pool**.
**Expect:** the deposit **fails** (reverts). No note is created, balance unchanged.

### Test 6.3: Unblock
**Do:** **Unblock**, then deposit again.
**Expect:** deposit succeeds.

### Test 6.4: Existing money still spendable while blocked
**Do:** block again, then pay an invoice from a note you already own.
**Expect:** payment still works. The blocklist screens **deposits only** (that is the v1 design).

### Test 6.5: Disclose one payment to an auditor
**Do:** **Payment to disclose** = Coffee payment → **Disclose to auditor**.
**Expect:** result box says the auditor verified that one payment (amount and invoice), and nothing about other payments.

## Part 7. Observer table (privacy check)

**Do:** after Parts 3-6, read the whole **What a public blockchain observer sees** table.

**Expect, line by line:**
- *Deposit* rows: sender is the payer wallet.
- *Payment* rows (relayer mode): sender is the relayer, recipient is a one-time address.
- No row contains the invoice memo, the invoice ID in plain form, or any link between a deposit and a payment.

## Part 8. Restart behavior

**Do:** press Ctrl+C in Terminal A, run `npm run demo` again, reload the page.
**Expect:** a clean empty demo (fresh chain, no old invoices or notes). The verifier's replay memory also resets. This is expected for the demo.

---

## Part 9. Direct API tests (for the curious)

The demo starts two services you can poke directly. On Windows PowerShell use `curl.exe` (with the `.exe`).

### 9.1 Verifier health
```bash
curl.exe http://127.0.0.1:8787/healthz
```
**Expect:** `{"ok":true}`

### 9.2 Verifier rejects junk
```bash
curl.exe -X POST http://127.0.0.1:8787/verify-receipt -H "content-type: application/json" -d "{\"proof\":1,\"publicSignals\":[]}"
```
**Expect:** HTTP 400, `{"ok":false,"error":"malformed"}`

Other verifier answers to know:

| Code | `error` | Meaning |
|---|---|---|
| 400 | `malformed` | wrong shape |
| 422 | `wrong_verifier` | receipt was made for a different verifier |
| 422 | `unknown_root` | receipt refers to a pool state the chain never had |
| 422 | `bad_proof` | proof was tampered with |
| 409 | `replayed` | already used |

To try `bad_proof` in the UI: in the browser developer console (F12) you can copy a real receipt from the network tab, change one digit of any `publicSignals` value, and POST it to `/verify-receipt`. Expect a rejection (`bad_proof`, `unknown_root` or `wrong_verifier` depending on which number you changed).

### 9.3 Relayer info
```bash
curl.exe http://127.0.0.1:8788/info
```
**Expect:** JSON with the relayer `address` and `minFee` (0.01 ETH in wei = `10000000000000000`).

### 9.4 Relayer rejects junk
```bash
curl.exe -X POST http://127.0.0.1:8788/relay -H "content-type: application/json" -d "{}"
```
**Expect:** HTTP 400, `malformed`. A real request with a fee below the minimum gives `fee_too_low`; a bad proof gives `would_revert` (the relayer checks before spending gas).

### 9.5 Rate limit
**Do:** call `/healthz` more than 60 times in one minute (PowerShell: `1..70 | % { curl.exe -s -o NUL -w "%{http_code} " http://127.0.0.1:8787/healthz }`).
**Expect:** the first ~60 return `200`, later ones `429`.

### 9.6 Oversized body
**Expect:** a request body larger than 16 KB is refused (HTTP 413).

## Part 10. Admin and performance checks

### 10.1 Admin controls (pause, deposit cap, ownership)
Covered by automatic test 10 (`npm test`). To rerun just that: `npx hardhat test --grep "admin controls"`.
**Expect:** while paused, deposits and payments revert; unpausing restores them; ownership moves only after the new owner accepts.

### 10.2 Benchmarks
**Do:** `npm run bench`
**Expect:** a table of proof time (pay about 1-2 s, receipt under 1 s), verify time (tens of ms), gas, and a file `docs/bench-latest.json`. Your numbers will differ from the README.

### 10.3 Standalone verifier (optional)
In one terminal `npm run node`, then in another deploy and start the verifier:
```bash
npx hardhat run scripts/deploy.js --network localhost
RPC_URL=http://127.0.0.1:8545 POOL_ADDRESS=<address printed by deploy> VERIFIER_ID=42 npm run verifier
```
(PowerShell: set `$env:RPC_URL=...` etc. first.) **Expect:** `/healthz` returns ok on the port the verifier prints.

### 10.4 Free public testnet (optional)
Follow the Sepolia section of the README with a **throwaway key** that never held real money. **Expect:** deploy prints contract addresses.

---

## Part 11. If something fails

| Symptom | Fix |
|---|---|
| `circom` missing | `npm run fetch:circom` |
| `build/` or `contracts/generated` missing | `npm run setup` |
| "port in use" / node exits on start | close whatever uses 3000, 8545, 8787 or 8788 |
| SQLite experimental warning | harmless |
| Page shows nothing / buttons do nothing | check Terminal A for errors, reload the page |
| "Prove and pay" is slow (>30 s) | first proof warms up; try again; check CPU load |
| Weird state after many clicks | restart `npm run demo` (Part 8) |

## Part 12. Master checklist (tick as you go)

- [ ] `npm test` shows 13 passing
- [ ] `npm run demo:smoke` shows all PASS
- [ ] 3.1-3.2 invoices created
- [ ] 3.3 deposit works, shows payer wallet
- [ ] 3.4 relayer payment: observer sender is the relayer
- [ ] 3.5 direct payment: observer sender is the payer
- [ ] 3.6-3.8 bad inputs refused
- [ ] 4.1-4.4 scan, sweep, fresh addresses
- [ ] 5.1 receipt accepted, 5.2 replay rejected, 5.3 second receipt accepted
- [ ] 6.1-6.3 block, blocked deposit fails, unblock
- [ ] 6.4 existing notes still spendable while blocked
- [ ] 6.5 disclosure verified by auditor
- [ ] 7 observer table leaks no link between deposit and payment
- [ ] 9.1-9.6 API checks
- [ ] 10.1-10.2 admin and benchmark checks

*Note: this guide was written from the code and README, not by clicking through the live demo. If a message differs slightly in wording (for example capitalization), the behavior matters, not the exact text. Tell me about any step that does not match and I will fix the guide.*
