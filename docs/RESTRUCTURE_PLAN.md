# Restructure Plan — TypeScript-First + LLM Buyer Agent

**Goal:** Remove Rust API overhead, add an LLM-driven buyer agent, wire CoralOS cleanly.  
**Result:** One language (TypeScript), one server (`api-ts/`), three agent types, CoralOS coordination.

---

## What we end up with

```
CoralOS (Docker :5555)
    │
    │ MCP  (each agent is a Docker container or Node process)
    ├── helius-monitor   TypeScript — watches wallet, confirms SOL payment
    ├── data-seller      TypeScript — serves data behind x402/MPP paywall
    └── llm-buyer        TypeScript + Claude — reasons, pays, gets data
                              │
                              │ @solana/kit  (keypair from env, devnet)
                         Solana devnet ← Helius WebSocket

web/ (Next.js :3000)  →  api-ts/ (Express :8081)  →  sdk/agent-core-ts/
```

No Rust. No separate binary to compile. Students fork, `npm install`, go.

---

## Phase 1 — Delete `api/` (Rust REST server)

**Delete the directory:**
```sh
git rm -r api/
```

**Also delete `runtime/` (Rust library):**  
`runtime/agent-core/` has no consumers once `api/` is gone. It stays as a
read-only reference only if we want a "Rust fork" path — otherwise delete it
too and halve the repo weight.

> Decision point: keep `runtime/` as a labelled "advanced/Rust" example, or delete?
> Recommendation: delete. `sdk/agent-core-ts/` mirrors it completely. Dead code
> in a starter kit confuses students more than it helps them.

**Remove from CI:**  
Delete the `rust:` and `e2e:` jobs in `.github/workflows/ci.yml` that depend on `cargo`.

**What `api-ts/` still needs** (gaps vs the deleted Rust server):

| Endpoint | Gap | Fix |
|----------|-----|-----|
| `POST /api/v1/solana-pay/url` | Missing | Add — 10 lines, `@solana/pay` npm pkg |
| `POST /api/v1/solana-pay/validate` | Missing | Add — `@solana/web3.js` getTransaction |
| `POST /api/v1/workflows` | Missing | Add — `sdk/agent-core-ts/workflow.ts` exists |
| `PUT /api/v1/swarm/config` | Missing | Add — store URL in memory, pass to CoralMcpAgent |
| `POST /api/v1/swarm/mcp/join` | Missing | Add — `coral_mcp.ts` already exists in SDK |
| `POST /api/v1/solana-pay/x402/demo` | Missing | Add — port `demo_payment_flow` from Rust |

These are all small additions to `api-ts/src/app.ts` — the SDK already has all
the logic, routes just need wiring.

---

## Phase 2 — Add `LLMBuyerStrategy`

**New file:** `sdk/agent-core-ts/src/strategies/llm_buyer.ts`

The buyer agent:
1. Receives a goal via `handleMessage` (e.g. "get weather in London")
2. Asks Claude which paid endpoint to call (tool: `call_paid_endpoint`)
3. Gets a 402 response → extracts the Solana Pay URL
4. Signs and sends a SOL transfer from a devnet keypair (env: `BUYER_KEYPAIR`)
5. Retries the endpoint → gets data → returns result

```typescript
// Rough shape
export class LLMBuyerStrategy extends BaseStrategy {
  readonly name = 'llm-buyer'

  async handleMessage(goal: string, state: MutableAgentState): Promise<string> {
    // 1. Claude decides what to call
    // 2. fetch() → 402 → parse Solana Pay URL
    // 3. @solana/kit: load keypair, build transfer tx, send
    // 4. fetch() again with payment proof → return data
  }
}
```

**Dependencies to add to `sdk/agent-core-ts/package.json`:**
```json
"@anthropic-ai/sdk": "^0.39",
"@solana/kit": "^2",
"@solana/pay": "^0.3"
```

**New env vars in `.env.example`:**
```sh
ANTHROPIC_API_KEY=
BUYER_KEYPAIR=          # base58 devnet keypair — never use mainnet
BUYER_BUDGET_SOL=0.01   # max the buyer will spend per request
```

---

## Phase 3 — Python coral-agents (keep as-is)

`runtime/coral-agents/helius_monitor/` and `user_proxy/` are native MCP agents.
CoralOS launches them as Docker containers. No changes needed.

If `runtime/agent-core/` is deleted, move `coral-agents/` to the repo root:
```
coral-agents/
  helius_monitor/
  user_proxy/
```

And update `docs/coral/docker-compose.yml` mount path accordingly.

---

## Phase 4 (Optional) — `examples/mastra-buyer/`

A standalone Mastra agent that does the same job as `LLMBuyerStrategy` but using
the Mastra framework, so `/coralize-your-agent` works out of the box.

```
examples/mastra-buyer/
  package.json          ← @mastra/core, @solana/kit, @anthropic-ai/sdk
  src/
    index.ts            ← Mastra agent with two tools: call_paid_api, sign_transfer
    tools/
      call_paid_api.ts
      sign_transfer.ts
```

Students who want Mastra fork this folder. Students who want the raw pattern
look at `sdk/agent-core-ts/src/strategies/llm_buyer.ts`.

---

## What gets left behind

### Permanently lost

| Thing | Impact |
|-------|--------|
| **Rust-native agent path** | Students who know Rust and want a Rust agent have to start from scratch. The `runtime/agent-core/` README + this plan doc is all the guidance they get. |
| **Production-grade tx validation** | Rust's `solana-transaction-status` crate decodes full transaction data (inner instructions, token transfers, program logs). `@solana/web3.js` `getTransaction()` is good enough for devnet demos but misses edge cases in complex txs. |
| **`demo_payment_flow` → pay.sh integration** | The Rust server called `https://debugger.pay.sh` as a real 402 demo endpoint. This can be ported to TypeScript but it's a curl-equivalent, not hard. |
| **Cargo workspace CI** | The `rust:` CI job goes away. TypeScript CI covers the remaining codebase. |

### Still accessible (not lost, just less visible)

| Thing | Where it lives |
|-------|---------------|
| Rust agent-core patterns | `runtime/agent-core/README.md` — full API reference stays |
| x402/MPP parsing | `sdk/agent-core-ts/src/strategies/payment.ts` — `parse402Headers` is there |
| Helius monitoring | `sdk/agent-core-ts/src/strategies/helius_monitor.ts` — identical behaviour to Rust |
| CoralOS MCP client | `sdk/agent-core-ts/src/coral_mcp.ts` — TypeScript port exists |

---

## Do smart contracts come into play?

**For the base demo: no.** Direct SOL transfer (native system program) is all
you need. Solana Pay transfer URLs encode `solana:RECIPIENT?amount=X` — no
program involved, Phantom signs a `SystemProgram.transfer` instruction.

**Where smart contracts unlock real value:**

### Trustless escrow (Anchor PDA)

Right now the flow requires trust: buyer sends SOL to seller's wallet, seller
*promises* to deliver. An Anchor escrow flips this:

```
Buyer → depositFunds(escrow PDA)   ← funds locked, seller can't touch yet
Seller verifies deposit on-chain
Seller delivers data
Seller → claimFunds(escrow PDA)    ← released atomically
```

The LLM buyer agent can verify the escrow PDA exists before sending. No trust needed.

### On-chain access tokens (Token-2022)

Instead of a payment receipt header, mint a Token-2022 NFT on payment confirmation.
The seller checks token balance before serving data. Works across sessions,
transferable, composable with other programs.

### When to add them

| Use case | Smart contract needed? |
|----------|----------------------|
| Devnet demo, single session | ❌ direct transfer is fine |
| Hackathon Track 1 (agents trading autonomously) | ⚠️ escrow is a strong differentiator |
| Hackathon Track 3 (agent-accessible API) | ❌ x402/MPP header is sufficient |
| Production | ✅ escrow or access token mandatory |

The starter kit ships without an Anchor program. The `docs/anchor-wallet-demo.md`
design doc + the Solana skill (`/solana-setup`) gives students everything to add
one if they want Track 1 to be trustless.

---

## Execution order

```
1. [ ] git rm -r api/
2. [ ] Decision: delete runtime/ or label it "Rust reference"
3. [ ] Add 6 missing endpoints to api-ts/src/app.ts
4. [ ] Write sdk/agent-core-ts/src/strategies/llm_buyer.ts
5. [ ] Update .env.example with ANTHROPIC_API_KEY + BUYER_KEYPAIR
6. [ ] Update README.md Quick Start (already uses direct npm/cargo commands)
7. [ ] Move coral-agents/ if runtime/ deleted, update docker-compose mount
8. [ ] Update CI: remove rust job, confirm typescript jobs pass
9. [ ] (Optional) examples/mastra-buyer/
```
