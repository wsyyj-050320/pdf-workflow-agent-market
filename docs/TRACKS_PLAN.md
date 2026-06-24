# Hackathon Tracks — Implementation Plan

Three self-contained examples under `examples/`. Each is a minimal, fork-ready
starter for one hackathon track. They share `sdk/agent-core-ts` and `api-ts`
but run independently with their own `package.json` and README.

---

## What gets built

```
examples/
  track-1-pay-per-call/        ← HTTP 402 pay-per-request + LLM buyer agent
    anchor-escrow/             ← Anchor program sub-module (trustless escrow)
  track-2-agent-trading/       ← Two autonomous agents trading on-chain
  track-3-consumer-checkout/   ← Human pays with Phantom, gets result instantly
```

---

## Track 1 — Pay-Per-Call API

**Thesis:** Any API can charge per request using HTTP 402. The payment proof
IS the auth token. No accounts, no subscriptions.

### Payment flow

```
Buyer agent          Seller server (api-ts route)
────────────────     ────────────────────────────
GET /data         →  402  www-authenticate: x402=<challenge>
                         challenge = { recipient, amountSol, memo }
parse challenge   ←
sign SOL transfer
GET /data         →  x-payment-proof: <txSig>
                  ←  200  { data: "..." }
```

Direct transfer (basic): buyer signs a SystemProgram transfer to seller's
wallet, includes the `txSig` as proof. Seller verifies on-chain before responding.

Escrow transfer (advanced, Track 1 Anchor submodule): buyer deposits into a
PDA escrow → seller claims on delivery → buyer gets a refund if no delivery
within timeout. Trustless — neither party can steal.

### File layout

```
examples/track-1-pay-per-call/
  README.md
  package.json               ← deps: express, @solana/web3.js, @anthropic-ai/sdk
  .env.example               ← HELIUS_API_KEY, SELLER_WALLET, BUYER_KEYPAIR_B58

  server.ts                  ← Minimal Express seller: GET /data → 402 → verify → serve
  buyer.ts                   ← LLMBuyerStrategy standalone script: ask Claude,
                                handle 402, sign transfer, retry
  verify.ts                  ← shared helper: confirm txSig on-chain via Helius

  anchor-escrow/             ← Anchor program (sub-directory module)
    Anchor.toml              ← workspace: programs = ["programs/escrow"]
    package.json             ← @coral-xyz/anchor, @solana/web3.js
    Cargo.toml               ← [workspace] members = ["programs/escrow"]
    programs/
      escrow/
        Cargo.toml           ← name = "escrow", anchor-lang dep
        src/
          lib.rs             ← program entrypoint + 3 instructions
    tests/
      escrow.ts              ← Anchor TS tests using LiteSVM or localnet
    client/
      escrow_client.ts       ← typed TS client generated from IDL
```

### server.ts — what it does

- `GET /api/data` with no proof header → `402` + `x-payment-required` JSON body:
  ```json
  { "recipient": "SELLER_PUBKEY", "amountSol": 0.0001, "memo": "req-<uuid>" }
  ```
- `GET /api/data` with `x-payment-proof: <txSig>` header:
  - calls `verify.ts` — checks txSig exists on-chain, transferred ≥ amountSol to
    recipient, memo matches
  - `200` with data payload, or `402` again if invalid

### buyer.ts — what it does

Uses the Anthropic SDK (`claude-haiku-4-5` for cost) as the reasoning layer:

```
1. Claude receives goal: "fetch weather data for London"
2. Claude calls tool: fetch_data({ endpoint: "http://localhost:3001/api/data" })
3. fetch returns 402 + challenge
4. Claude calls tool: pay_and_retry({ challenge, keypairB58: process.env.BUYER_KEYPAIR_B58 })
5. pay_and_retry: loads keypair → builds SystemProgram.transfer tx → sends → waits confirm
6. fetch_data again with x-payment-proof header → 200 → Claude returns data to user
```

This is `LLMBuyerStrategy` from the RESTRUCTURE_PLAN, implemented as a standalone
script first, then extracted to `sdk/agent-core-ts/src/strategies/llm_buyer.ts`.

### anchor-escrow/programs/escrow/src/lib.rs — Anchor program

Three instructions:

| Instruction | Who calls | What it does |
|-------------|-----------|--------------|
| `initialize` | Buyer | Creates escrow PDA, transfers `amount` lamports from buyer into it, stores `seller`, `memo`, `deadline` (Unix timestamp) |
| `claim` | Seller | Verifies memo matches, transfers lamports from PDA to seller. Requires seller signature. |
| `refund` | Buyer | Callable only after `deadline`. Returns lamports to buyer. |

**PDA seeds:** `["escrow", buyer_pubkey, memo_bytes]` → unique per payment memo.

**Accounts on `initialize`:**
```
buyer          (Signer, mut)
escrow_pda     (PDA, mut, init)
system_program
```

**Why this matters for hackathon students:** eliminates trust between agents.
Buyer can't skip payment; seller can't take funds without delivering. This is
the building block for any agent marketplace.

### New .env keys needed (add to root .env.example)

```sh
ANTHROPIC_API_KEY=sk-ant-...
BUYER_KEYPAIR_B58=base58-encoded-devnet-keypair   # generate: solana-keygen new
BUYER_BUDGET_SOL=0.01
```

---

## Track 2 — Agent-to-Agent Trading

**Thesis:** Two agents autonomously discover each other's price, negotiate (or
not), and complete a SOL transfer — no human approves anything.

### Payment flow

```
Seller agent                       Buyer agent
────────────────                   ──────────────────────────────
run() → generate Solana Pay URL    run() → POST /api/v1/agents/seller/handle
        record url-generated                ↓
        wait for payment signal    receive URL → parse → check budget
                                   → sign SystemProgram.transfer
                                   → send on-chain
Helius WebSocket fires             Helius detects on same wallet
record payment-received    ←       record payment-sent
record delivering-data             ← GET /api/v1/agents/seller/handle
                                        { text: "gimme data" }
return data response               record data-received
```

Both agents run inside `AgentManager`. The seller uses `TransferStrategy` +
`HeliusMonitorStrategy`. The buyer uses a new `AutoBuyerStrategy`.

### File layout

```
examples/track-2-agent-trading/
  README.md
  package.json            ← sdk/agent-core-ts, @solana/web3.js, @solana/pay
  .env.example            ← HELIUS_API_KEY, SELLER_WALLET, BUYER_KEYPAIR_B58

  run.ts                  ← creates both agents in AgentManager, starts them,
                             wires MessageBus so buyer → seller on payment
  seller_strategy.ts      ← extends TransferStrategy: generates URL on start,
                             then delegates to HeliusMonitorStrategy to watch
  buyer_strategy.ts       ← AutoBuyerStrategy: reads URL from SharedState,
                             signs + sends transfer, records result
```

### seller_strategy.ts — what it does

1. On `run()`: generate Solana Pay URL for `process.env.SELLER_WALLET`
2. Write URL to `SharedState` key `"seller.paymentUrl"`
3. Subscribe to Helius `onAccountChange` on seller wallet
4. On payment detected: write to SharedState `"seller.lastPayment"`, publish
   `MessageBus` event `{ type: "payment-received", from: "seller" }`
5. `handleMessage("request-data")` → return the data payload

### buyer_strategy.ts — what it does

1. On `run()`: poll SharedState for `"seller.paymentUrl"` (retry 5× / 2s)
2. Parse URL → extract recipient + amount
3. If amount ≤ `BUYER_BUDGET_SOL`: build + sign SystemProgram.transfer
4. Broadcast tx, await confirmation
5. Call `AgentManager.dispatchMessage("seller", "request-data")`
6. Record response in own action log

### Key difference from Track 1

Track 2 has **no HTTP 402**. Agents communicate via `MessageBus` inside the
same process. The payment is Solana Pay transfer URL parsed out of SharedState.
Good for demos where you want to show the on-chain settlement loop without
setting up an HTTP server.

---

## Track 3 — Consumer Checkout

**Thesis:** A human connects Phantom, pays with one click, and immediately gets
something of value. Zero friction, sub-second confirmation.

### Payment flow

```
Browser (web/)                      api-ts server
──────────────                      ────────────────────────────────
POST /api/v1/checkout/request  →    build Transaction: SystemProgram.transfer
                               ←    { transaction: base64, message: "Pay 0.0001 SOL" }
Phantom.signAndSendTransaction →    on-chain broadcast
poll /api/v1/checkout/status   →    Helius confirms txSig
                               ←    { status: "confirmed", result: "..." }
show result to user            ←
```

This is **Solana Pay Transaction Request** protocol — the server builds the
unsigned transaction, Phantom signs it. The user never sees a `solana:` URL;
they just click Pay.

### File layout

```
examples/track-3-consumer-checkout/
  README.md
  package.json           ← express, @solana/web3.js, @solana/pay
  .env.example           ← HELIUS_API_KEY, SELLER_WALLET

  server.ts              ← two routes: POST /checkout/request (build tx),
                            GET  /checkout/status/:sig (poll confirm)
  web/
    index.html           ← single HTML file, no framework, wallet-adapter CDN
    app.ts               ← Phantom connect → signAndSendTransaction → poll
```

This is intentionally the simplest track. The `web/` here is a single HTML
page (not Next.js) so students can see the minimal Phantom integration without
framework overhead. The production version is `web/` at the repo root.

### server.ts — what it does

`POST /checkout/request`
- body: `{ account: string }` (buyer's pubkey from Phantom)
- build `Transaction` with `SystemProgram.transfer({ from: account, to: SELLER_WALLET, lamports })`
- serialize to base64, return `{ transaction, message }`

`GET /checkout/status/:sig`
- call Helius `getTransaction(sig)` with `commitment: "confirmed"`
- return `{ status: "confirmed"|"pending"|"failed", result }` where `result`
  is the data payload once confirmed

---

## What this repo already has vs what needs building

| Thing | Status | Track |
|-------|--------|-------|
| `TransferStrategy` — Solana Pay URL generation | ✅ exists | 1, 2 |
| `HeliusMonitorStrategy` — WebSocket account watch | ✅ exists | 1, 2 |
| `PaymentStrategy` — parse 402 + x402 headers | ✅ exists | 1 |
| `api-ts` server with AgentManager | ✅ exists | 2 |
| Phantom wallet flow in `web/` | ✅ exists | 3 |
| `LLMBuyerStrategy` (Anthropic SDK + pay) | ❌ build | 1 |
| `AutoBuyerStrategy` (sign transfer autonomously) | ❌ build | 2 |
| Track 1 `server.ts` — 402 seller | ❌ build | 1 |
| Track 1 `verify.ts` — on-chain sig check | ❌ build | 1 |
| Track 2 `run.ts` — two-agent orchestration | ❌ build | 2 |
| Track 3 `server.ts` — transaction request | ❌ build | 3 |
| Track 3 `web/index.html` — minimal Phantom | ❌ build | 3 |
| Anchor escrow program (`lib.rs`) | ❌ build | 1 |
| Anchor escrow TypeScript client | ❌ build | 1 |
| Anchor escrow tests | ❌ build | 1 |

---

## Dependencies needed

### Track 1 + 2 (`package.json` additions)

```json
"@anthropic-ai/sdk": "^0.44.0",
"@solana/web3.js": "^1.98.0",
"@solana/pay": "^0.2.5",
"bignumber.js": "^9.1.2"
```

### Track 1 Anchor sub-module

```toml
# programs/escrow/Cargo.toml
[dependencies]
anchor-lang = "0.30.1"
```

```json
// anchor-escrow/package.json
"@coral-xyz/anchor": "^0.30.1",
"@solana/web3.js": "^1.98.0"
```

### Track 3 (minimal)

```json
"@solana/web3.js": "^1.98.0",
"@solana/pay": "^0.2.5",
"express": "^4.18.0"
```

---

## Build order

1. **Track 1 core** — `server.ts` + `verify.ts` + `buyer.ts` (no Anchor yet)
   — proves the 402 loop works end-to-end
2. **Extract `LLMBuyerStrategy`** into `sdk/agent-core-ts/src/strategies/llm_buyer.ts`
   — shared across any track
3. **Anchor escrow** — `lib.rs` → `anchor build` → copy IDL → generate client
   — swap buyer.ts direct transfer for escrow flow
4. **Track 2** — `seller_strategy.ts` + `buyer_strategy.ts` + `run.ts`
   — reuses strategies from sdk, runs entirely in-process
5. **Track 3** — `server.ts` + `web/index.html`
   — lightest lift; mostly wiring existing @solana/web3.js + Phantom adapter

---

## What we leave behind

| Gap | Impact |
|-----|--------|
| No token payments (USDC) | All tracks use SOL. Students wanting USDC need Token-2022 work. |
| No mainnet config | Everything targets devnet. Mainnet requires funded wallets + real keys. |
| Anchor escrow has no dispute resolution | `refund` is time-locked but there is no on-chain arbitration. |
| Track 3 web is a plain HTML file | Students wanting a full React checkout need to adapt from `web/`. |
| No rate limiting on seller server | Track 1 server trusts that sig verification is enough. A replay attack within the same memo is possible without nonce tracking. |

---

## Smart contracts — do they come into play?

| Track | Smart contract needed? | Why |
|-------|----------------------|-----|
| Track 1 (basic) | No | SystemProgram transfer is enough. Native SOL, no program. |
| Track 1 (escrow) | **Yes — Anchor escrow** | Trustless: funds locked in PDA until seller delivers. |
| Track 2 | No | Transfer between known wallets, agents trust each other in demo context. |
| Track 3 | No | Phantom signs a SystemProgram transfer; server verifies on-chain. |

The Anchor escrow is the differentiator for Track 1 if students want to demo
trustless agent trading for the judges. Without it, the seller could take payment
and return nothing. With it, the PDA holds the funds and the seller must deliver
before the `claim` instruction releases them.
