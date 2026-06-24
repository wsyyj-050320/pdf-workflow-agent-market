# Coral Swarm Integration

How to wire the Coral Protocol multi-agent swarm into this app — what to implement in Rust and TypeScript, and what becomes possible with Solana once it is done.

---

## Current state

The infrastructure is mostly there. `coral_mcp.rs` has a complete MCP client. `coral-server` exposes `/api/v1/coralos/mcp/join` and `/api/v1/coralos/mcp/status/:name`. `transport.ts` routes CoralOS config and session listing. The gap is that joining a swarm connects the agent but the mention handler is a hardcoded stub — it never routes to the agent's actual strategy.

---

## What needs to be implemented

### Rust — 3 changes

#### 1. Add `handle_message` to the `Strategy` trait

**File:** `runtime/agent-core/src/strategy.rs`

The trait only has `run` (a polling loop). There is no way to feed an inbound Coral mention to a running strategy and get a typed response back. Add a default method:

```rust
#[async_trait]
pub trait Strategy: Send + Sync {
    async fn run(&self, state: Arc<Mutex<AgentState>>);
    fn name(&self) -> &'static str;

    /// Handle an inbound Coral mention and return a reply string.
    /// Default: echo the text back. Override in payment strategies.
    async fn handle_message(
        &self,
        text: &str,
        _state: Arc<Mutex<AgentState>>,
    ) -> String {
        format!("unhandled: {}", text)
    }
}
```

Then override `handle_message` in each payment strategy:

**`TransferStrategy`** — parse the mention as a transfer URL request:

```rust
async fn handle_message(&self, text: &str, state: Arc<Mutex<AgentState>>) -> String {
    // Expect JSON: {"recipient":"...", "amount":0.01, "label":"..."}
    if let Ok(req) = serde_json::from_str::<serde_json::Value>(text) {
        let recipient = req["recipient"].as_str().unwrap_or("").to_string();
        let amount = req["amount"].as_f64();
        let label = req["label"].as_str().map(str::to_owned);
        let url = crate::solana_pay::encode_transfer_url(
            &crate::solana_pay::TransferUrlFields {
                recipient, amount, label,
                spl_token: None, reference: None,
                message: None, memo: None,
            }
        );
        state.lock().unwrap().actions.push(AgentAction {
            timestamp: chrono::Utc::now(),
            action_type: "coral-url-generated".to_string(),
            details: url.clone(),
            tx_signature: None, slot: None, latency_ms: 0,
        });
        return url;
    }
    "error: expected {\"recipient\":\"...\",\"amount\":0.01}".to_string()
}
```

**`PaymentStrategy`** — parse as a 402 endpoint and run the demo flow:

```rust
async fn handle_message(&self, text: &str, state: Arc<Mutex<AgentState>>) -> String {
    // Expect JSON: {"endpoint":"https://...","budget":1000000}
    if let Ok(req) = serde_json::from_str::<serde_json::Value>(text) {
        let endpoint = req["endpoint"].as_str().unwrap_or("").to_string();
        let budget = req["budget"].as_u64().unwrap_or(1_000_000);
        let result = super::payment::demo_payment_flow(&endpoint, budget).await;
        let summary = serde_json::to_string(&result).unwrap_or_default();
        state.lock().unwrap().actions.push(AgentAction {
            timestamp: chrono::Utc::now(),
            action_type: "coral-payment-result".to_string(),
            details: summary.chars().take(200).collect(),
            tx_signature: None, slot: None, latency_ms: 0,
        });
        return summary;
    }
    "error: expected {\"endpoint\":\"https://...\",\"budget\":1000000}".to_string()
}
```

---

#### 2. Expose `Arc<Agent>` from `AgentManager`

**File:** `runtime/agent-core/src/manager.rs`

The existing `get_agent_state` returns a snapshot clone — not the live agent. The `mcp_join` handler needs the live agent to call `handle_message` on its strategy. Add:

```rust
/// Return a live reference to the agent, or `None` if not found.
pub fn get_agent(&self, id: &str) -> Option<Arc<Agent>> {
    let agents = self.agents.lock().expect("agent map lock poisoned");
    agents.get(id).map(Arc::clone)
}
```

Also expose `get_strategy` on `Agent` in `agent.rs`:

```rust
pub fn get_strategy(&self) -> Arc<dyn Strategy> {
    Arc::clone(&*self.strategy.lock().expect("strategy lock poisoned"))
}
```

---

#### 3. Wire mention dispatch in `mcp_join`

**File:** `api/src/api/coralos.rs`, lines 144–159

Replace the hardcoded acknowledgement with a real dispatch:

```rust
// Before:
async move {
    mgr.record_action(&name, AgentAction { ... });
    format!("rust-agent={} acknowledged", name)
}

// After:
async move {
    let reply = if let Some(agent) = mgr.get_agent(&name) {
        let strategy = agent.get_strategy();
        let state = agent.state_arc(); // Arc<Mutex<AgentState>>
        strategy.handle_message(&mention.text, state).await
    } else {
        format!("agent {} not found", name)
    };

    mgr.record_action(
        &name,
        agent_core::AgentAction {
            timestamp: chrono::Utc::now(),
            action_type: "coral-mention".to_string(),
            details: mention.text.chars().take(200).collect(),
            tx_signature: None,
            slot: None,
            latency_ms: 0,
        },
    );

    reply
}
```

`state_arc()` needs adding to `Agent` — return `Arc::clone(&self.state)`.

---

### TypeScript — 4 changes

#### 1. Add missing commands to `transport.ts`

**File:** `web/app/transport.ts`

Add to the CoralOS section of `httpDispatch`:

```typescript
case 'coralos_mcp_join':
  return httpPost('/api/v1/coralos/mcp/join', {
    connection_url: args.connectionUrl,
    agent_name: args.agentName,
  })

case 'coralos_mcp_status':
  return httpGet(`/api/v1/coralos/mcp/status/${args.name}`)
```

---

#### 2. Add MCP join UI to the CoralOS tab

**File:** `web/app/App.tsx`

Add state at the top of `App()`:

```tsx
const [mcpConnectionUrl, setMcpConnectionUrl] = useState('')
const [mcpAgentName, setMcpAgentName] = useState('')
const [mcpJoining, setMcpJoining] = useState(false)
const [mcpStatuses, setMcpStatuses] = useState<Record<string, boolean>>({})
```

Add a handler:

```tsx
const handleMcpJoin = async () => {
  if (!mcpConnectionUrl.trim() || !mcpAgentName.trim()) return
  setMcpJoining(true)
  try {
    await invoke('coralos_mcp_join', {
      connectionUrl: mcpConnectionUrl.trim(),
      agentName: mcpAgentName.trim(),
    })
    const active = await invoke<boolean>('coralos_mcp_status', { name: mcpAgentName.trim() })
    setMcpStatuses(p => ({ ...p, [mcpAgentName.trim()]: active }))
  } finally {
    setMcpJoining(false)
  }
}
```

Add to the CoralOS tab JSX (below the session list card):

```tsx
<div className="card space-y-3">
  <h2 className="section-title">Join Swarm as Rust Agent</h2>
  <p className="text-xs text-gray-500">
    Paste the CORAL_CONNECTION_URL from a running Coral session. Pick a local agent to
    act as the Coral participant — it will receive mentions and reply using its strategy.
  </p>
  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
    <div>
      <label className="block text-xs text-gray-500 mb-1">CORAL_CONNECTION_URL</label>
      <input
        className="input-field"
        placeholder="http://localhost:5555/mcp?..."
        value={mcpConnectionUrl}
        onChange={e => setMcpConnectionUrl(e.target.value)}
      />
    </div>
    <div>
      <label className="block text-xs text-gray-500 mb-1">Local agent to use</label>
      <select
        className="input-field"
        value={mcpAgentName}
        onChange={e => setMcpAgentName(e.target.value)}
      >
        <option value="">Select agent…</option>
        {agentsWithRoles.map(([id, , meta]) => (
          <option key={id} value={id}>{id} ({meta.role})</option>
        ))}
      </select>
    </div>
  </div>
  <div className="flex items-center gap-3">
    <button className="btn-primary" onClick={handleMcpJoin} disabled={mcpJoining}>
      {mcpJoining ? 'Joining…' : 'Join Swarm'}
    </button>
    {Object.entries(mcpStatuses).map(([name, active]) => (
      <span key={name} className="flex items-center gap-1 text-xs font-mono">
        <span className={`status-dot ${active ? 'running' : 'stopped'}`} />
        {name}
      </span>
    ))}
  </div>
</div>
```

---

#### 3. Style `coral-mention` actions

**File:** `web/app/App.tsx`, `actionBadgeClass` function (line ~611)

```typescript
const known: Record<string, string> = {
  "payment-received":      "type-payment-received",
  "data-delivered":        "type-data-delivered",
  "data-received":         "type-data-received",
  "data-request":          "type-data-request",
  "url-generated":         "type-url-generated",
  "coral-mention":         "type-url-generated",   // ← add
  "coral-url-generated":   "type-data-delivered",  // ← add
  "coral-payment-result":  "type-payment-received", // ← add
  "strategy-start":        "type-strategy-start",
  "poll-tick":             "type-poll-tick",
  "poll-error":            "type-poll-error",
  "rpc-error":             "type-rpc-error",
}
```

---

#### 4. Fix the CoralOS URL default

**File:** `web/app/App.tsx`, line ~138

```typescript
// Before:
const [coralUrl, setCoralUrl] = useState("http://localhost:8080")

// After:
const [coralUrl, setCoralUrl] = useState("http://localhost:5555")
```

The coral-server (this app) runs on 8080. The Coral Protocol swarm server (installed via `/coral-setup`) runs on 5555. The CoralOS tab talks to the swarm server, not itself.

---

## What becomes possible with Solana after this is implemented

Once the mention dispatch is wired, any agent in a Coral swarm session can delegate real Solana operations to a Rust agent in this app. Everything below is a direct call to existing code — no new Rust logic required.

---

### 1. Delegated Solana Pay URL generation

The orchestrator (Claude Code, Hermes) sends a mention to a `TransferStrategy` agent with a JSON payload. The agent calls `encode_transfer_url` and returns the `solana:` URI into the Coral thread. The orchestrator can then post it to a user, embed it in a QR code, or pass it to another agent.

```
Orchestrator → @pay-agent {"recipient":"7xKF...","amount":0.01,"label":"DataFeed"}
pay-agent    → solana:7xKF...?amount=0.01&label=DataFeed
```

---

### 2. Delegated transaction validation

The orchestrator sends a transaction signature to a `TransferStrategy` agent, which calls `validate_transfer` against the RPC and returns the full `ValidationResult` — amount transferred, slot, fee, sender, whether the recipient was found.

```
Orchestrator → @pay-agent {"action":"validate","signature":"3xK...","recipient":"7xKF..."}
pay-agent    → {"valid":true,"amount_transferred":0.01,"slot":298401920,"fee_lamports":5000}
```

The orchestrator can then decide whether to release data, flag a discrepancy, or trigger another workflow step.

---

### 3. Delegated 402 payment flows

The orchestrator sends a paywalled endpoint URL to a `PaymentStrategy` agent. The agent runs `demo_payment_flow`: hits the endpoint, extracts the MPP or x402 challenge, builds the payment header, retries, and returns the full `DemoPaymentResult`. The orchestrator gets structured JSON back — not a curl output it has to parse.

```
Orchestrator → @pay-agent {"endpoint":"https://debugger.pay.sh/mpp/quote/AAPL","budget":1000000}
pay-agent    → {"success":true,"challenge":{"protocol":"mpp","amount":100,"token":"USDC"},...}
```

---

### 4. Triton payment monitoring as a swarm participant

The `TritonPaymentMonitorStrategy` opens a persistent WebSocket to Triton and emits a `payment-received` action the moment an SOL transfer lands. With swarm integration, this becomes an event source inside the Coral session: when the monitor detects a payment, it calls `send_message` back into the Coral thread, and the orchestrator routes the next workflow step.

Flow:
```
Orchestrator creates session with: claude-code + hermes + triton-monitor (this app)
Orchestrator → @triton-monitor {"recipient":"7xKF...","amount":0.001}
triton-monitor starts watching (Triton WebSocket)
[user sends SOL on-chain]
triton-monitor → @orchestrator {"event":"payment-received","signature":"4aB...","slot":298401921}
Orchestrator → @claude-code deliver the data
```

---

### 5. Multi-agent Anchor escrow coordination

Combined with the Anchor escrow program described in `anchor-wallet-demo.md`, the swarm can coordinate all three on-chain phases:

| Phase | Agent | Coral role |
|-------|-------|------------|
| Escrow creation | `AnchorEscrowStrategy` Rust agent | Receives "create escrow" mention, calls `create_escrow` instruction, returns PDA address |
| Deposit | User's Phantom wallet (frontend) | Outside Coral — user signs `deposit_funds` in the browser |
| Deposit detection | Triton monitor agent | Watches escrow PDA, fires `payment-received` mention when funded |
| Claim | `AnchorEscrowStrategy` Rust agent | Receives trigger from orchestrator, calls `claim_funds`, returns tx signature |
| Data delivery | Orchestrator / Hermes | Routes data to buyer once claim is confirmed |

The orchestrator never touches Solana directly. It just sends and receives messages. The Rust agents handle all on-chain operations.

---

### 6. Parallel multi-wallet monitoring

The swarm spawns N Triton monitor agents in parallel (one per wallet or escrow PDA) and lets the orchestrator aggregate results. Without Coral this requires N background tokio tasks that are hard to coordinate. With Coral each monitor is an independent participant with its own thread — the orchestrator can kill individual monitors, add new ones, or collect their outputs into a shared result.

```
Orchestrator spawns:
  monitor-a (watching wallet-1)
  monitor-b (watching wallet-2)
  monitor-c (watching escrow-pda-x)

Orchestrator thread: "report when any of you sees a payment"

monitor-b → @orchestrator payment detected — 0.5 SOL from 3xK...
Orchestrator → kill monitor-a, monitor-c
Orchestrator → @hermes summarise payment-b and post to Slack
```

---

### 7. Cross-framework agent swarms

The Coral swarm can include agents from any framework. A realistic production swarm for a Solana payment product:

| Agent | Framework | Role |
|-------|-----------|------|
| `orchestrator` | Claude Code (this app) | Decompose tasks, route decisions |
| `researcher` | Hermes / GPT-4 | Research counterparties, validate addresses |
| `solana-agent` | Rust (this app) | All on-chain operations — sign, validate, monitor |
| `compliance-agent` | Mastra TypeScript | Jurisdiction checks, AML screening |
| `notifier` | Hermes | Slack / email / Discord delivery |

The Rust agent is the only participant that can touch Solana. Everything else talks to it through the Coral thread. This is a clean architectural boundary: blockchain operations stay in Rust where the SDK is mature, and language/reasoning tasks go to whatever LLM or framework is best at them.

---

## Implementation order

```
1. Add handle_message to Strategy trait (strategy.rs)
   — default impl first, then override in TransferStrategy and PaymentStrategy

2. Add get_agent + get_strategy + state_arc to manager.rs / agent.rs

3. Wire mention dispatch in coralos.rs mcp_join handler

4. Add coralos_mcp_join + coralos_mcp_status to transport.ts

5. Fix coralUrl default (8080 → 5555) in App.tsx

6. Add MCP join card to CoralOS tab in App.tsx

7. Add coral-* action badge classes in App.tsx

8. Test: run coral-setup skill → install claude-code + puppet agents →
   coral-agent-swarm skill → join swarm with a local TransferStrategy agent →
   send {"recipient":"...","amount":0.01} mention → verify URL returned in thread
```

Total: 7 files touched, no breaking changes to existing REST routes.
