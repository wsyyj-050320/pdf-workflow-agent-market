# CoralOS × Solana — Full Build Plan

Everything needed to turn this repo into a proper multi-agent CoralOS + Solana
payment system. Three competitive tracks, each with a live frontend, autonomous
agents, and on-chain SOL settlement.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  web/  Next.js                                                      │
│  /track-1  /track-2  /track-3   (one frontend, three route pages)   │
└───────────────────────┬─────────────────────────────────────────────┘
                        │ HTTP (api-ts :8081)
┌───────────────────────▼─────────────────────────────────────────────┐
│  api-ts/  Express :8081                                             │
│  /agents  /messages  /shared-state  /weather                        │
└───────────────────────┬─────────────────────────────────────────────┘
                        │ MCP (@modelcontextprotocol/sdk)
┌───────────────────────▼─────────────────────────────────────────────┐
│  CoralOS  Docker :5555                                              │
│  ├── seller-agent   TypeScript MCP container                        │
│  ├── buyer-agent    TypeScript MCP container                        │
│  └── helius-monitor Python MCP container  (already exists)          │
└──────────┬──────────────────────────────┬───────────────────────────┘
           │ MCP mentions                 │ Helius WebSocket
           │ + Solana Pay URLs            ▼
           │                    Solana devnet
           ▼                    onAccountChange
    Anthropic API               txSig confirm
    (buyer LLM reasoning)
```

CoralOS spawns each agent as a Docker container and passes `CORAL_CONNECTION_URL`.
Agents connect via MCP, register tools, and wait for `@mentions` in the session thread.
The frontend polls `api-ts` for agent state and renders results live.

---

## The Gap — What Needs Refactoring

`CoralMcpAgent` in `sdk/agent-core-ts/src/coral_mcp.ts` currently *joins* a
CoralOS session from inside the `api-ts` process. It needs to *be* the process.

### Before (embedded)
```
api-ts process
  └── AgentManager
        └── CoralMcpAgent.joinSession()   ← one of many agents inside api-ts
```

### After (standalone container)
```
seller-agent Docker container
  └── coral_mcp_server.ts                 ← IS the process
        ├── receives CORAL_CONNECTION_URL
        ├── connects via MCP
        ├── registers tools
        └── blocks, waiting for @mentions
```

---

## Risks

### 🔴 Critical — MCP wiring

`coral_mcp_server.ts` is the single point of failure. CoralOS is Kotlin/JVM and
its TypeScript MCP support is not well documented. If the transport layer,
tool registration format, or `@mention` routing doesn't match what CoralOS
expects, none of the three tracks work.

**Mitigation:** build `coral_mcp_server.ts` first, test it against a live
CoralOS Docker container before writing any agent logic. One afternoon with a
`console.log("connected")` stub is worth more than three days of seller/buyer
code that can't connect.

**Gate:** do not proceed to Step 2 until a TypeScript container successfully
joins a CoralOS session and responds to a test `@mention`.

### 🟡 High — Anchor escrow setup cost

The Anchor escrow (Track 1 differentiator) requires Rust + Solana CLI + Anchor
CLI on the student's machine to build. That's a non-trivial setup for a
hackathon — Rust compile times alone can kill momentum on day 1.

**Mitigation:** ship the escrow program pre-compiled. Publish the IDL and a
pre-built `.so` to the repo. Students use the TypeScript client only — they
never run `anchor build`. Only students who want to modify the program need
the full Rust toolchain.

### 🟡 High — Docker on Windows

`docker compose up` working first try on a Windows laptop is optimistic.
Docker Desktop networking, volume mount permissions, Helius WebSocket
connections through NAT, and wallet keypair file paths all have Windows-specific
failure modes.

**Mitigation:**
- Test the full `docker compose up` flow on a Windows machine before publishing
- Provide a `docker compose up` troubleshooting section in each track README
- Add a `--no-docker` fallback: `npm run dev:track-1` that runs agents as local
  Node processes instead of containers, for students who can't get Docker working

---

## Build Order

**Step 1 is the gate. Do not skip ahead.**

```
Step 1  coral_mcp_server.ts + live CoralOS test     ← GATE: must connect before anything else
Step 2  coral-agents/seller-agent/                  TS + Dockerfile + coral-agent.toml
Step 3  coral-agents/buyer-agent/                   TS + Dockerfile + coral-agent.toml
Step 4  docs/coral/track-{1,2,3}-config.toml        per-track CoralOS session configs
Step 5  examples/track-{1,2,3}/docker-compose.yml   thin launchers per track
Step 6  web/app/track-{1,2,3}/page.tsx              frontend page per track
Step 7  anchor-escrow/ pre-compile + publish IDL    after everything else works
```

---

## Step 1 — coral_mcp_server.ts

New file: `sdk/agent-core-ts/src/coral_mcp_server.ts`

```typescript
// Standalone CoralOS MCP agent entrypoint.
// Usage: CORAL_CONNECTION_URL=... node coral_mcp_server.js
//
// Receives CORAL_CONNECTION_URL from CoralOS at container start.
// Connects via MCP, registers tools, blocks until session ends.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export interface AgentTool {
  name: string
  description: string
  inputSchema: object
  handler: (input: unknown) => Promise<unknown>
}

export async function startMcpAgent(tools: AgentTool[]): Promise<void> {
  const url = process.env.CORAL_CONNECTION_URL
  if (!url) throw new Error('CORAL_CONNECTION_URL not set')

  const client = new Client({ name: process.env.AGENT_NAME ?? 'agent', version: '0.1.0' })
  const transport = new StreamableHTTPClientTransport(new URL(url))

  client.setRequestHandler('tools/call', async (req) => {
    const tool = tools.find(t => t.name === req.params.name)
    if (!tool) throw new Error(`unknown tool: ${req.params.name}`)
    return { content: [{ type: 'text', text: JSON.stringify(await tool.handler(req.params.arguments)) }] }
  })

  client.setRequestHandler('tools/list', async () => ({
    tools: tools.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))
  }))

  await client.connect(transport)
  await new Promise(() => {})  // block until container exits
}
```

All TypeScript agents import `startMcpAgent` and pass their tools. No agent
needs to know anything about the MCP wire protocol.

---

## Step 2 — coral-agents/seller-agent/

```
coral-agents/seller-agent/
  src/
    index.ts          ← calls startMcpAgent with seller tools
    service.ts        ← ← ← FORK POINT: what does the seller deliver?
    payment.ts        ← generate Solana Pay URL, verify tx on-chain
  coral-agent.toml    ← CoralOS agent registry entry
  Dockerfile
  package.json
  tsconfig.json
```

### src/index.ts

```typescript
import { startMcpAgent } from '../../../sdk/agent-core-ts/src/coral_mcp_server.js'
import { generatePaymentUrl, verifyPayment } from './payment.js'
import { deliverService } from './service.js'

await startMcpAgent([
  {
    name: 'generate_payment_url',
    description: 'Generate a Solana Pay URL for a service request',
    inputSchema: { type: 'object', properties: { request: { type: 'string' }, memo: { type: 'string' } } },
    handler: async ({ request, memo }) => ({
      url: await generatePaymentUrl({ request, memo }),
      amountSol: Number(process.env.PRICE_SOL ?? 0.0001),
    }),
  },
  {
    name: 'verify_payment',
    description: 'Verify a Solana transaction signature on-chain',
    inputSchema: { type: 'object', properties: { sig: { type: 'string' }, memo: { type: 'string' } } },
    handler: async ({ sig, memo }) => ({ verified: await verifyPayment(sig, memo) }),
  },
  {
    name: 'deliver_data',
    description: 'Deliver the service response after payment is confirmed',
    inputSchema: { type: 'object', properties: { request: { type: 'string' } } },
    handler: async ({ request }) => ({ result: await deliverService(request) }),
  },
])
```

### src/service.ts — the fork point

```typescript
// ← FORK HERE — replace with your service

export async function deliverService(request: string): Promise<string> {
  // DEFAULT: Jupiter DEX swap quote
  const url = `https://quote-api.jup.ag/v6/quote?inputMint=So11111111111111111111111111111111111111112&outputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&amount=1000000000&slippageBps=50`
  const res = await fetch(url)
  const data = await res.json()
  return JSON.stringify({ quote: data, request })

  // Other examples:
  // const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd`)
  // const res = await fetch(`https://newsapi.org/v2/top-headlines?q=${request}&apiKey=${process.env.NEWS_API_KEY}`)
  // return myLLMInference(request)
  // return myDatabaseQuery(request)
}
```

### coral-agent.toml

```toml
name = "seller-agent"
description = "Sells data and services for SOL via Solana Pay"
version = "0.1.0"

[docker]
image = "seller-agent:0.1.0"
environment = [
  "CORAL_CONNECTION_URL",
  "SELLER_WALLET",
  "HELIUS_API_KEY",
  "PRICE_SOL",
]
```

### Dockerfile

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package.json tsconfig.json ./
COPY src/ ./src/
COPY ../../../sdk/agent-core-ts/ ./sdk/agent-core-ts/
RUN npm install && npm run build
CMD ["node", "dist/index.js"]
```

---

## Step 3 — coral-agents/buyer-agent/

```
coral-agents/buyer-agent/
  src/
    index.ts          ← calls startMcpAgent with buyer tools
    goal.ts           ← ← ← FORK POINT: what does the buyer want?
    wallet.ts         ← load keypair, sign + send SOL transfer
  coral-agent.toml
  Dockerfile
  package.json
```

### src/index.ts

Uses Anthropic SDK as the reasoning layer. Claude decides when to pay,
what to ask for, and whether the response was worth it.

```typescript
import Anthropic from '@anthropic-ai/sdk'
import { startMcpAgent } from '../../../sdk/agent-core-ts/src/coral_mcp_server.js'
import { signAndSendTransfer } from './wallet.js'
import { BUYER_GOAL, BUYER_MAX_SOL } from './goal.js'

const anthropic = new Anthropic()

await startMcpAgent([
  {
    name: 'request_and_pay',
    description: 'Request data from seller agent, pay if required',
    inputSchema: { type: 'object', properties: { query: { type: 'string' } } },
    handler: async ({ query }) => {
      // Claude loop: ask seller → get URL → decide to pay → retry
      const result = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        system: BUYER_GOAL,
        messages: [{ role: 'user', content: query }],
        tools: [
          { name: 'call_seller', description: 'Call seller generate_payment_url tool', input_schema: { type: 'object', properties: { request: { type: 'string' }, memo: { type: 'string' } } } },
          { name: 'pay_invoice', description: 'Sign and send SOL transfer', input_schema: { type: 'object', properties: { solanaUrl: { type: 'string' } } } },
        ],
      })
      // handle tool use loop...
      return { result: result.content }
    },
  },
  {
    name: 'pay_invoice',
    description: 'Sign and send a Solana Pay transfer URL',
    inputSchema: { type: 'object', properties: { solanaUrl: { type: 'string' } } },
    handler: async ({ solanaUrl }) => {
      const sig = await signAndSendTransfer(solanaUrl, BUYER_MAX_SOL)
      return { sig, paid: !!sig }
    },
  },
])
```

### src/goal.ts — the fork point

```typescript
// ← FORK HERE — what does your buyer agent want?

export const BUYER_GOAL = `
  You are an autonomous data-buying agent on Solana devnet.
  Your job: fetch the best Jupiter swap quote for SOL → USDC.
  You have a budget. Pay the seller if the data looks useful.
  Always verify the payment URL is a valid solana: transfer URL before paying.
`

export const BUYER_MAX_SOL = 0.001  // never spend more than this per request
```

### coral-agent.toml

```toml
name = "buyer-agent"
description = "LLM-driven autonomous buyer — pays SOL for data and services"
version = "0.1.0"

[docker]
image = "buyer-agent:0.1.0"
environment = [
  "CORAL_CONNECTION_URL",
  "ANTHROPIC_API_KEY",
  "BUYER_KEYPAIR_B58",
  "BUYER_MAX_SOL",
]
```

---

## Step 4 — Per-Track CoralOS Session Configs

### docs/coral/track-1-config.toml — Pay-Per-Call + Anchor Escrow

```toml
[server]
port = 5555

[[agent]]
name = "seller-agent"
mode = "docker"
image = "seller-agent:0.1.0"
env = { PRICE_SOL = "0.0001", ESCROW_MODE = "true" }

[[agent]]
name = "buyer-agent"
mode = "docker"
image = "buyer-agent:0.1.0"

[[agent]]
name = "helius-monitor"
mode = "docker"
image = "helius-monitor:0.1.0"

[session]
thread = "track-1-pay-per-call"
auto_start = ["seller-agent", "helius-monitor"]
```

### docs/coral/track-2-config.toml — Agent-to-Agent Trading

```toml
[server]
port = 5555

[[agent]]
name = "seller-agent"
mode = "docker"
image = "seller-agent:0.1.0"
env = { PRICE_SOL = "0.0005", SERVICE = "birdeye-trending" }

[[agent]]
name = "buyer-agent"
mode = "docker"
image = "buyer-agent:0.1.0"
env = { BUYER_GOAL = "Buy Solana token trend data every 30 seconds" }

[[agent]]
name = "helius-monitor"
mode = "docker"
image = "helius-monitor:0.1.0"

[session]
thread = "track-2-agent-trading"
auto_start = ["seller-agent", "buyer-agent", "helius-monitor"]
```

### docs/coral/track-3-config.toml — Consumer Checkout

```toml
[server]
port = 5555

[[agent]]
name = "seller-agent"
mode = "docker"
image = "seller-agent:0.1.0"
env = { PRICE_SOL = "0.00005", SERVICE = "news-headlines" }

[[agent]]
name = "helius-monitor"
mode = "docker"
image = "helius-monitor:0.1.0"

[[agent]]
name = "user-proxy"
mode = "docker"
image = "user-proxy:0.1.0"

[session]
thread = "track-3-consumer-checkout"
auto_start = ["seller-agent", "helius-monitor", "user-proxy"]
```

---

## Step 5 — Track Docker Compose Files

Each track is one file. Students `docker compose up` and everything starts.

### examples/track-1-pay-per-call/docker-compose.yml

```yaml
services:
  coral:
    image: ghcr.io/coral-protocol/coral-server:latest
    ports: ["5555:5555"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ../../docs/coral/track-1-config.toml:/config/config.toml:ro
      - ../../coral-agents:/agents:ro
    env_file: ../../.env

  web:
    build: ../../web
    ports: ["3000:3000"]
    environment:
      - NEXT_PUBLIC_CORAL_SERVER=http://coral:5555
      - NEXT_PUBLIC_TRACK=1
    depends_on: [coral]
```

### examples/track-2-agent-trading/docker-compose.yml

```yaml
services:
  coral:
    image: ghcr.io/coral-protocol/coral-server:latest
    ports: ["5555:5555"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ../../docs/coral/track-2-config.toml:/config/config.toml:ro
      - ../../coral-agents:/agents:ro
    env_file: ../../.env

  web:
    build: ../../web
    ports: ["3000:3000"]
    environment:
      - NEXT_PUBLIC_CORAL_SERVER=http://coral:5555
      - NEXT_PUBLIC_TRACK=2
    depends_on: [coral]
```

### examples/track-3-consumer-checkout/docker-compose.yml

```yaml
services:
  coral:
    image: ghcr.io/coral-protocol/coral-server:latest
    ports: ["5555:5555"]
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ../../docs/coral/track-3-config.toml:/config/config.toml:ro
      - ../../coral-agents:/agents:ro
    env_file: ../../.env

  web:
    build: ../../web
    ports: ["3000:3000"]
    environment:
      - NEXT_PUBLIC_CORAL_SERVER=http://coral:5555
      - NEXT_PUBLIC_TRACK=3
    depends_on: [coral]
```

---

## Step 6 — Frontends

One Next.js app (`web/`), three track pages. Each page polls `api-ts` for
agent state and renders the live session.

```
web/app/
  track-1/
    page.tsx    ← Pay-Per-Call dashboard
  track-2/
    page.tsx    ← Agent Trading terminal
  track-3/
    page.tsx    ← Consumer Checkout (Phantom)
```

---

### Track 1 Frontend — Pay-Per-Call Dashboard

**URL:** `localhost:3000/track-1`

```
┌──────────────────────────────────────────────────────────────┐
│  🔵 Seller Agent          💰 Pay-Per-Call API                │
│  Selling: Jupiter Swap Quotes                                │
│  Price: 0.0001 SOL per query (~$0.015)                      │
│  Wallet: 7xK...f9  [Solana Explorer ↗]                      │
├──────────────────────────────────────────────────────────────┤
│  🤖 Buyer Agent                           [RUNNING]          │
│  Goal: "Fetch best SOL→USDC swap route every 30s"           │
│  Budget: 0.001 SOL remaining                                 │
├──────────────────────────────────────────────────────────────┤
│  Live Session Feed                                           │
│  ──────────────────────────────────────────────────────────  │
│  12:01:03  buyer  → seller  "request swap quote SOL→USDC"   │
│  12:01:03  seller → buyer   solana:7xK...?amount=0.0001     │
│  12:01:04  buyer  paid      txSig: 3xK...ab  [Explorer ↗]  │
│  12:01:05  seller delivered {"outAmount":"142.3 USDC",...}  │
│  12:01:35  buyer  → seller  "request swap quote SOL→USDC"   │
│  ...                                                         │
├──────────────────────────────────────────────────────────────┤
│  Escrow PDA: 9mZ...11  [0.0001 SOL locked]  [Explorer ↗]   │
└──────────────────────────────────────────────────────────────┘
```

Components:
- `AgentStatusCard` — polls `GET /api/v1/agents/:id` every 2s
- `SessionFeed` — polls CoralOS thread messages, renders @mentions + tx links
- `EscrowStatus` — reads PDA balance via Helius RPC
- No wallet needed — agents pay autonomously

---

### Track 2 Frontend — Agent Trading Terminal

**URL:** `localhost:3000/track-2`

```
┌─────────────────────────────┬────────────────────────────────┐
│  📈 SELLER AGENT            │  🤖 BUYER AGENT                │
│  Service: Birdeye Trending  │  Goal: Token trend analysis    │
│  Price: 0.0005 SOL          │  Budget: 0.01 SOL              │
│  ─────────────────────────  │  ──────────────────────────    │
│  13:00:00 session-start     │  13:00:01 scanning for seller  │
│  13:00:01 url-generated     │  13:00:02 found seller         │
│  13:00:03 waiting-payment   │  13:00:03 evaluating price     │
│  13:00:05 payment-received  │  13:00:04 price ok, paying     │
│           sig: 4aB...cd     │  13:00:05 paid sig: 4aB...cd  │
│  13:00:05 delivering-data   │  13:00:05 received data        │
│  13:00:35 url-generated     │  13:00:35 evaluating...        │
├─────────────────────────────┴────────────────────────────────┤
│  On-Chain Settlement                                         │
│  Total paid: 0.003 SOL across 6 trades  [all on Explorer]   │
│  ████████████████░░░░  Budget: 70% used                     │
└──────────────────────────────────────────────────────────────┘
```

Components:
- Two-panel `AgentTerminal` — live action log per agent
- `SettlementBar` — running SOL total + budget progress
- All payments linkable to Solana Explorer

---

### Track 3 Frontend — Consumer Checkout

**URL:** `localhost:3000/track-3`

```
┌──────────────────────────────────────────────────────────────┐
│  ⚡ Instant Crypto News                                      │
│  Pay 0.00005 SOL (~$0.007) · Get top 5 headlines now        │
│                                                              │
│  [Connect Phantom]                                           │
│                                                              │
│  ──────────────────────────────────────────────────────────  │
│  After connecting:                                           │
│                                                              │
│  🟢 Connected: 9mZ...11  (Devnet)                           │
│  Balance: 0.42 SOL                                          │
│                                                              │
│  Topic: [crypto ▼]    [Pay 0.00005 SOL →]                  │
│                                                              │
│  ──────────────────────────────────────────────────────────  │
│  ✅ Paid · txSig: 3xK...ab  [Explorer ↗]                   │
│                                                              │
│  1. Bitcoin hits new ATH as ETF inflows surge               │
│  2. Solana DEX volume overtakes Ethereum for third week      │
│  3. Fed signals rate cut — crypto markets react             │
│  4. Jupiter announces new perps protocol                    │
│  5. Phantom wallet passes 10M users                         │
└──────────────────────────────────────────────────────────────┘
```

Components:
- `PhantomConnect` — existing wallet adapter from `web/`
- `PayButton` — calls `POST /api/v1/checkout/request` → Phantom popup → poll confirm
- `ResultCard` — shows headlines + tx proof link
- No agents visible — this is a consumer product

---

## What Each Track Becomes as a Real App

| Track | Fork `service.ts` to | Real-world product |
|-------|---------------------|-------------------|
| 1 | AI inference API | "Pay per Claude/GPT call, no account" |
| 1 | Private data feed | "Institutional-grade on-chain data, per query" |
| 2 | DeFi signal service | "Autonomous trading agent that buys alpha" |
| 2 | Compute marketplace | "Agents bidding for GPU time in real time" |
| 3 | Gated content | "Pay-per-article, crypto-native Substack" |
| 3 | AI art generator | "Pay SOL, get AI image, no signup" |

---

## Environment Variables — Full Set

Add to `.env.example`:

```sh
# Existing
HELIUS_API_KEY=your_helius_api_key_here
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=your_helius_api_key_here
SOLANA_WS_URL=wss://devnet.helius-rpc.com/?api-key=your_helius_api_key_here
CORAL_SERVER_URL=http://localhost:5555
WALLET=
AMOUNT_SOL=0.0005

# New — required for buyer-agent
ANTHROPIC_API_KEY=sk-ant-...
BUYER_KEYPAIR_B58=           # devnet keypair: solana-keygen new --no-bip39-passphrase
BUYER_MAX_SOL=0.001

# New — optional per track
PRICE_SOL=0.0001             # seller price per request
NEWS_API_KEY=                # track 3 news demo (newsapi.org free tier)
```

---

## What Students Actually Do to Fork

```sh
# 1. Fork + clone
gh repo fork your-org/pay --clone && cd pay

# 2. Configure
cp .env.example .env
# fill in: HELIUS_API_KEY, ANTHROPIC_API_KEY, BUYER_KEYPAIR_B58

# 3. Pick a track and run it
docker compose -f examples/track-1-pay-per-call/docker-compose.yml up

# 4. Open http://localhost:3000/track-1 — live session running

# 5. Fork the service
code coral-agents/seller-agent/src/service.ts
# replace deliverService() with your own API call

# 6. Rebuild and redeploy
docker compose -f examples/track-1-pay-per-call/docker-compose.yml up --build

# Done — their hackathon entry is running
```

---

## File Diff vs Current Repo

### New files

```
sdk/agent-core-ts/src/coral_mcp_server.ts
coral-agents/seller-agent/src/index.ts
coral-agents/seller-agent/src/service.ts        ← FORK POINT
coral-agents/seller-agent/src/payment.ts
coral-agents/seller-agent/coral-agent.toml
coral-agents/seller-agent/Dockerfile
coral-agents/seller-agent/package.json
coral-agents/buyer-agent/src/index.ts
coral-agents/buyer-agent/src/goal.ts            ← FORK POINT
coral-agents/buyer-agent/src/wallet.ts
coral-agents/buyer-agent/coral-agent.toml
coral-agents/buyer-agent/Dockerfile
coral-agents/buyer-agent/package.json
docs/coral/track-1-config.toml
docs/coral/track-2-config.toml
docs/coral/track-3-config.toml
examples/track-1-pay-per-call/docker-compose.yml
examples/track-1-pay-per-call/anchor-escrow/    ← Anchor program
examples/track-2-agent-trading/docker-compose.yml
examples/track-3-consumer-checkout/docker-compose.yml
web/app/track-1/page.tsx
web/app/track-2/page.tsx
web/app/track-3/page.tsx
```

### Modified files

```
sdk/agent-core-ts/src/coral_mcp.ts    refactor: extract standalone entrypoint
.env.example                          add ANTHROPIC_API_KEY, BUYER_KEYPAIR_B58
```

### Unchanged

```
api-ts/         still used by the web frontend for agent state polling
web/            add 3 new pages, all existing pages stay
coral-agents/helius_monitor/   already correct
coral-agents/user_proxy/       already correct
```

---

## Verdict

The concept is right. The DX is right. The APIs are real.

**This is genuinely competitive hackathon infrastructure if the MCP wiring works.**

The entire bet is `coral_mcp_server.ts`. If a TypeScript container can join a
CoralOS session, respond to `@mentions`, and call back with tool results — the
rest is just plumbing. If it can't, nothing else matters.

Build Step 1. Test it against a live CoralOS Docker container. Get a
`console.log("connected")` before writing a single line of seller or buyer
logic. One afternoon of integration testing is the difference between a repo
that works and one that looks good in a plan doc.

After the gate passes:
- Steps 2–6 are straightforward TypeScript — a few days of focused work
- The Anchor escrow is a differentiator, not a requirement — ship it last
- Windows Docker issues are real but solvable with a `--no-docker` fallback
- Students who fork this have a working payment system on day one

**The competition is what students put in `service.ts`. Make it easy to change
that one function and everything else takes care of itself.**
