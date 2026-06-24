# pay — Solana Agent Economy Starter

Agents request, pay, and settle on-chain automatically — no human in the loop.

Three ready-to-fork tracks: autonomous agent APIs, agent-to-agent trading, and consumer checkout with Phantom. Every payment is a real on-chain Solana transaction.

---

## Prerequisites

- [Node.js 20+](https://nodejs.org)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (running)
- [Phantom wallet](https://phantom.app) browser extension — Track 3 only

---

## Quick start

```sh
git clone https://github.com/trilltino/pay
cd pay
cd scripts && npm install && cd ..
node scripts/setup.js
```

The setup script generates two devnet wallets and writes your `.env`. It will print two wallet addresses — **fund both at [faucet.solana.com](https://faucet.solana.com)** (1 SOL each), then pick a track and run:

```sh
cd examples/track-1-pay-per-call
docker compose up
```

Docker pulls the pre-built images from `ghcr.io/trilltino` automatically — no build step needed.

Optional keys for better performance (not required to run):

```sh
JUPITER_API_KEY=   # jup.ag/developers — higher rate limits
HELIUS_API_KEY=    # helius.dev — faster RPC
```

---

## Track 1 — Pay-Per-Call API

An autonomous buyer agent continuously pays a seller agent for Jupiter DEX swap quotes. No human involved — both agents run in Docker, talk over CoralOS, and settle on Solana devnet.

```
Buyer agent → "request SOL to USDC quote"
Seller agent → Solana Pay URL
Buyer agent → pays 0.0001 SOL on-chain
Seller agent → verifies tx → delivers Jupiter quote
```

**Run it:**

```sh
cd examples/track-1-pay-per-call
docker compose up
```

**Open:** [http://localhost:3000/track-1](http://localhost:3000/track-1)

You'll see a live feed of requests, on-chain payment signatures, and delivered quotes.

**Fork it** — change what the seller sells in one file:

```typescript
// coral-agents/seller-agent/src/service.ts
export async function deliverService(request: string) {
  // ← your service here
}
```

---

## Track 2 — Agent-to-Agent Trading

Same as Track 1 but the buyer loops every 30 seconds, building up a trade history. Useful for demonstrating recurring autonomous payments or a simple data subscription model.

**Run it:**

```sh
cd examples/track-2-agent-trading
docker compose up
```

**Open:** [http://localhost:3000/track-2](http://localhost:3000/track-2)

Side-by-side live logs for seller and buyer. Every payment links to Solana Explorer.

**Fork it** — same `service.ts` entrypoint as Track 1. Change `BUYER_REQUEST` in `coral-agents/buyer-agent/src/goal.ts` to change what the buyer asks for.

---

## Track 3 — Consumer Checkout

A human connects Phantom, picks a topic, and clicks Pay. The payment settles on-chain and the result is delivered instantly — no backend login, no API key, just a wallet.

**Run it:**

```sh
cd examples/track-3-consumer-checkout
docker compose up
```

**Open:** [http://localhost:3000/track-3](http://localhost:3000/track-3)

Connect Phantom (set to Devnet), pick a topic, click Pay 0.00005 SOL. You'll see the tx confirmed and the result appear.

**Fork it** — same `service.ts` as above. Change the `TOPICS` array in `web/app/track-3/page.tsx` to match your service.

---

## Repo Layout

| Directory | Purpose |
|-----------|---------|
| `coral-agents/seller-agent/` | Sells data for SOL — fork `src/service.ts` |
| `coral-agents/buyer-agent/` | Pays autonomously — fork `src/goal.ts` |
| `api-ts/` | Express REST API on port 8081 |
| `sdk/agent-core-ts/` | Agent runtime: CoralOS MCP, Solana Pay, messaging |
| `web/` | Next.js frontend — `/track-1`, `/track-2`, `/track-3` |
| `examples/` | One `docker-compose.yml` per track |
| `docs/` | CoralOS config and design docs |

---

## How the payment cycle works

```
Buyer sends "request <query>" → Seller
Seller replies with solana:<wallet>?amount=0.0001&memo=pay-<id>
Buyer signs + broadcasts the transaction on devnet
Buyer sends "paid <sig> memo=pay-<id>" → Seller
Seller calls connection.getTransaction(sig) — verifies amount + recipient
Seller delivers the data
```

All verification happens on-chain. No off-chain trust required.

---

## Development (without Docker)

```sh
# API server
cd api-ts && npm install && npm run dev    # :8081

# Web
cd web && npm install && npm run dev       # :3000

# Type check everything
cd sdk/agent-core-ts && npm run typecheck
cd api-ts && npm run typecheck
cd web && npm run typecheck
```

---

## License

MIT
