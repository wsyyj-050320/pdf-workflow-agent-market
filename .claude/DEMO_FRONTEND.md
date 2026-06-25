# Demo Frontend — Audit & Completion Plan

**The frontend:** the bridge self-serves one file — `examples/agent-economy/bridge/web/index.html` —
a Phantom checkout at `http://localhost:3010`. Backed by the bridge's `/order` + `/order/:ref/paid`
endpoints (which talk to coral-server's puppet + session APIs).

---

## Verdict

It **fully shows ONE example** — the *human checkout* front door, end to end. It does **not** show
the other half of the thesis — *agents paying each other autonomously* — which today is only visible
in `docker logs`. So for a complete "agent economy" demo, the UI is **half the story**.

---

## What it shows today ✅

The human-checkout example, complete and real:

1. Connect Phantom (devnet)
2. Pick a service (Jupiter quote / CoinGecko / Claude inference)
3. **Request & Pay** → the seller's price comes back → Phantom signs a **reference-bound** transfer
4. Activity timeline: order opened (reference) → **paid on-chain** (Explorer link) → **delivered** (pretty-printed result)

That's a legitimate, judge-able example: *a human pays a seller agent 0.0001 devnet SOL for a service,
settled and verified on-chain.*

## What it can't show today ❌

| Capability | Status | Why it matters for the demo |
|---|---|---|
| **Autonomous agent↔agent loop** | ❌ logs only | This is the headline — "agents that pay each other." Invisible in the UI. |
| **The CoralOS conversation** (`request → PAYMENT_REQUIRED → paid → DELIVERED`) | ❌ | Judges see the buyer's *steps* but not the actual protocol messages or the seller's side |
| **Seller's verify/deliver perspective** | ❌ | The "seller verified on-chain" moment is narrated, not shown |
| **Order history / running total** | ❌ | Can't show "5 settlements, 0.0005 SOL" — no sense of throughput |
| **System status** (coral up? seller ready?) | ❌ | A live status dot makes it feel like a running system |

---

## Completion plan

### 1. Autonomous viewer — **highest impact**
Show the agent↔agent loop live, in the browser.

- **Bridge (new endpoints):**
  - `POST /autonomous/start` — create a `[buyer-agent, seller-agent]` session (the logic already in
    `autonomous/start.ts`, moved server-side).
  - `GET /autonomous/feed` — read that session's thread from the **extended state** (the bridge
    already does this read for the human path) and return the messages.
- **UI:** an **"Autonomous"** tab with a *"Run agent↔agent demo"* button and a **live conversation
  feed** — each `request → PAYMENT_REQUIRED → paid <sig> → DELIVERED → ANALYSIS` rendered as chat
  bubbles between 🤖 buyer and 🏪 seller, with Explorer links on every payment.

### 2. Conversation view for the human path
Alongside the existing timeline, surface the **raw thread messages** for the current order (the
seller's `PAYMENT_REQUIRED` and `DELIVERED`), so the protocol is visible, not just narrated. Powered
by the same extended-state read.

### 3. Order history + running total *(frontend-only)*
Keep a list of completed orders and sum the SOL spent + count of settlements. Pure JS, no backend.

### 4. System status *(small)*
Extend `/health` to also report coral reachability + whether the seller spawned; show a status dot in
the header.

### Layout
One page, two tabs — the two front doors side by side:

```
┌ Agent Economy ───────────────── ● devnet ┐
│  [ Checkout (human) ] [ Autonomous (agents) ]
│
│  Checkout    → connect → service → pay → delivered   (today)
│  Autonomous  → "Run demo" → live buyer⇄seller feed   (to build)
└───────────────────────────────────────────┘
```

---

## What the completed demo will show

Both front doors, live, on one screen:

- **A human** paying a seller agent (Phantom, on-chain) — *already works*
- **Agents** paying each other autonomously — the buyer requesting, the seller pricing, the on-chain
  payment, the delivery, the Claude analysis — as a live conversation
- Every payment a **real devnet transaction** with an Explorer link
- The **CoralOS coordination** made visible (the protocol messages), and a running tally of settlements

That's the full thesis — *agents and humans transacting on-chain, coordinated by CoralOS* — on a
single page, instead of half of it in a browser and half in a terminal.

## Effort

- #1 Autonomous viewer: **M** (2 small bridge endpoints + a tab + a polling feed)
- #2 Conversation view: **S** (reuse the extended-state read)
- #3 History/total: **S** (frontend only)
- #4 Status: **S**

Highest-impact-first: **#1**. It's the single thing that turns the demo from "a checkout page" into
"watch an agent economy run."
