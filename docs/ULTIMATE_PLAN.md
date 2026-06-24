# The Ultimate Plan — What This Becomes

Combines: coral-swarm-integration.md + anchor-wallet-demo.md + web frontend upgrade.

---

## What you get at the end

A fully working **agentic payment marketplace** where:

- A user opens a polished web app, connects Phantom, and browses data agents for sale
- They pick one and click Pay — Phantom pops up, they sign once
- An on-chain Anchor escrow locks their SOL trustlessly
- A CoralOS swarm of Rust agents coordinates the delivery automatically:
  - Orchestrator routes the request to the right seller agent
  - Helius monitor detects the deposit on the escrow PDA
  - Seller agent claims funds and delivers data back through the Coral thread
  - Buyer's wallet receives confirmation on-chain
- The whole flow — request → escrow → payment → delivery — takes under 5 seconds
- No subscriptions. No API keys. No human approval. Just wallet + agents.

**This is a production-ready architecture, not a demo.** Swap what the seller delivers and you have a real product.

---

## Full stack after implementation

```
┌──────────────────────────────────────────────────────────────────┐
│  web/   Next.js 14 + shadcn/ui + Tailwind                        │
│  Marketplace → Payment → Result  (3 screens)                     │
│  Wallet adapter: Phantom signs depositFunds on Anchor escrow      │
└────────────────────────┬─────────────────────────────────────────┘
                         │ HTTP (sdk/sdk CoralClient)
┌────────────────────────▼─────────────────────────────────────────┐
│  api/   Axum REST API (port 8080)                        │
│  /agents  /workflows  /messages  /state                           │
│  /solana-pay  /pay-demo  /coralos/mcp/join                        │
└────────────────────────┬─────────────────────────────────────────┘
                         │ Rust crate
┌────────────────────────▼─────────────────────────────────────────┐
│  agent-core/   Rust library                                       │
│  AgentManager · Strategy (+ handle_message) · MessageBus          │
│  SharedState · WorkflowEngine · CoralMcpSession                   │
│  solana_pay/ · AnchorEscrowStrategy (new)                         │
└──────┬───────────────────────────────┬────────────────────────────┘
       │ MCP (rmcp)                    │ Helius WebSocket
┌──────▼──────────────────┐   ┌───────▼────────────────────────────┐
│  CoralOS swarm (Docker) │   │  Solana devnet                     │
│  Orchestrator           │   │  Anchor escrow PDA                 │
│  Hermes                 │   │  Helius: accountSubscribe          │
│  Puppet (user proxy)    │   │  Phantom: signs depositFunds       │
│  + Rust agents (this)   │   └────────────────────────────────────┘
└─────────────────────────┘
```

---

## Implementation: 4 phases

---

### Phase 1 — Coral swarm wiring (7 file changes, no breaking changes)

**From:** `docs/coral-swarm-integration.md`

Rust agents currently join CoralOS but reply with a hardcoded stub. These changes make them real swarm participants that route mentions to their actual Strategy.

| File | Change |
|------|--------|
| `agent-core/src/strategy.rs` | Add `handle_message` default method to Strategy trait |
| `agent-core/src/strategy.rs` | Override in `TransferStrategy` (generate Solana Pay URL) |
| `agent-core/src/strategy.rs` | Override in `PaymentStrategy` (run demo_payment_flow) |
| `agent-core/src/agent.rs` | Add `get_strategy()` and `state_arc()` methods |
| `agent-core/src/manager.rs` | Add `get_agent(id)` returning `Option<Arc<Agent>>` |
| `api/src/api/coralos.rs` | Wire mention dispatch: call `strategy.handle_message()` instead of stub |
| `web/app/transport.ts` | Add `coralos_mcp_join` and `coralos_mcp_status` to httpDispatch |
| `web/app/App.tsx` | Add MCP join card to CoralOS tab |
| `web/app/App.tsx` | Fix coralUrl default: 8080 → 5555 |
| `web/app/App.tsx` | Add coral-mention / coral-url-generated / coral-payment-result badge classes |

**Result after Phase 1:** Any Coral orchestrator (Claude Code, Hermes, Puppet) can send a mention to a local Rust agent and get back a real Solana Pay URL, a payment validation result, or a full 402 payment flow — over MCP, in the Coral thread.

---

### Phase 2 — Anchor escrow program (5 new files)

**From:** `docs/anchor-wallet-demo.md`

Adds trustless on-chain escrow so neither seller nor buyer has to trust the other.

| File | What |
|------|------|
| `programs/escrow/Cargo.toml` | Anchor program workspace member |
| `programs/escrow/src/lib.rs` | `create_escrow`, `deposit_funds`, `claim_funds`, `refund` instructions |
| `agent-core/src/solana_pay/anchor_escrow.rs` | Rust `AnchorEscrowStrategy` — creates escrow PDA, watches for deposit, claims |
| `sdk/agent-core-ts/src/strategies/anchor_escrow.ts` | TypeScript buyer strategy — builds `deposit_funds` tx for Phantom to sign |
| `web/app/AnchorDemo.tsx` | React tab: wallet connect + pay button + escrow status |

**Result after Phase 2:** The existing Helius monitor watches the escrow PDA instead of a plain wallet. Seller never sees funds until Anchor confirms delivery. User signs exactly one transaction in Phantom.

---

### Phase 3 — Nice web frontend (Next.js)

**New directory:** `web/`

A polished consumer-facing app on top of the existing `coral-server` REST API.

```
web/
  app/
    page.tsx              — Marketplace: grid of available data agents
    pay/[agentId]/
      page.tsx            — Payment: prompt input + Phantom sign
    result/[txSig]/
      page.tsx            — Result: delivery confirmation + data output
  components/
    AgentCard.tsx         — Data feed card (name, price, category)
    WalletButton.tsx      — Connect/disconnect Phantom
    PayButton.tsx         — Builds + signs Anchor depositFunds tx
    AgentLiveLog.tsx      — Real-time agent action feed (polls /agents/:id)
  lib/
    coral.ts              — CoralClient instance (sdk/sdk)
    anchor.ts             — Program + IDL helpers
    wallet.ts             — Wallet adapter setup
```

Tech stack: `Next.js 14 (app router)` + `shadcn/ui` + `@solana/wallet-adapter-react` + `@coral-xyz/anchor`

**Result after Phase 3:** A URL you can share. User opens it in any browser with Phantom installed, connects wallet, pays 0.001 SOL, gets a data response in under 5 seconds.

---

### Phase 4 — End-to-end demo flow (wires all 3 phases together)

The full demo that makes all of it visible at once:

```
1. /coral-setup skill          → CoralOS docker running on port 5555
2. cargo run (coral-server)    → Rust agents available on port 8080
3. npm run dev (web/)          → Polished web app on port 3000

4. Open web app → Connect Phantom → Browse agents
5. Click "Buy Stock Price Feed (0.001 SOL)"
6. Web app calls coral-server → seller agent creates Anchor escrow PDA
7. Web app shows escrow PDA + Pay button
8. User signs depositFunds in Phantom
9. Helius detects deposit on PDA (< 1 second)
10. Seller agent (via CoralOS mention dispatch) calls claim_funds
11. Seller delivers {"AAPL": 189.42} into SharedState
12. Web app polls SharedState → displays result
13. Web app shows "Delivered in 1.2s" + on-chain tx link
```

Nothing in steps 6–12 requires the user to click anything. Agents handle it.

---

## What can be built on top of this

Once this is running, replacing the demo data with a real product takes one Strategy change:

| Product | What the seller Strategy does |
|---------|------------------------------|
| **AI inference marketplace** | Calls Claude/GPT API with buyer's prompt, returns response |
| **Live data oracle** | Fetches external API (prices, weather, sports), signs result |
| **Compute rental** | Runs a Docker container, returns output hash |
| **Private API gateway** | Issues a time-limited JWT on payment, buyer hits the API |
| **Content streaming** | Streams audio/video frames at microprice per chunk |
| **Agent treasury** | WorkflowEngine drives multi-agent vote → escrow payout |

The payment rail, escrow, monitoring, and CoralOS coordination work identically for all of them.

---

## File count summary

| Phase | Files added/changed | Compile step |
|-------|-------------------|-------------|
| Phase 1: Coral wiring | 10 (mostly small edits) | `cargo build -p agent-core -p coral-server` |
| Phase 2: Anchor escrow | 5 (3 Rust, 1 TS, 1 React) | `anchor build` + `cargo build` |
| Phase 3: Web frontend | ~12 (all new under web/) | `npm run dev` in web/ |
| Phase 4: Demo wiring | 0 (config + env vars only) | — |
| **Total** | **~27** | |

No existing REST routes change. All additions are additive. (Tauri has been removed — the stack is now web/ + api/ + runtime/.)
