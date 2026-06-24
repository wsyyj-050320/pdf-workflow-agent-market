# sol_coralos — Web Frontend

Polished Next.js 14 marketplace for the Solana agentic payment demo.

## Run

```sh
# 1. Install dependencies
npm install

# 2. Copy env
cp .env.local.example .env.local
# fill in NEXT_PUBLIC_HELIUS_RPC with your key from helius.dev

# 3. Start the Rust API in another terminal
cd ../api && cargo run

# 4. Start the web app
npm run dev
# → http://localhost:3000
```

## Stack

- **Next.js 14** (app router)
- **Tailwind CSS** — dark theme with Solana brand colours
- **@solana/wallet-adapter-react** — Phantom wallet connection
- **@coral-xyz/anchor** — Anchor escrow program client (Phase 2)
- **sdk/sdk** — CoralClient HTTP wrapper for the Rust API

## Pages

| Route | What |
|-------|------|
| `/` | Marketplace — browse data agents for sale |
| `/pay/[agentId]` | Payment — enter prompt, sign with Phantom |
| `/result/[txSig]` | Result — agent delivery + live action log |

## Architecture

```
Browser (Next.js)
  └─ WalletProvider   → Phantom via @solana/wallet-adapter
  └─ lib/coral.ts     → CoralClient → api :8080
  └─ @solana/web3.js  → Solana devnet RPC

api/ (Rust/Axum :8080)
  └─ agent-core       → AgentManager, SharedState, WorkflowEngine
```

## Demo flow (no API server needed)

1. Open `/` — see four agent listings
2. Connect Phantom on devnet
3. Click **Buy** on any agent → fill in a prompt → **Pay X SOL**
4. Phantom signs a devnet transfer
5. `/result/[txSig]` shows a mock JSON response after 3 s (demo fallback)
   — replace with live data when the API server is running
