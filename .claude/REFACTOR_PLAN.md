# Codebase Refactor Plan — Idiomatic, Modular, Documented

**Goal:** Every public API and module has inline doc comments. Module boundaries are clean. No dead code.

## Scope

Active source directories only:
- `sdk/agent-core-ts/src/` — TypeScript agent runtime (core library)
- `api-ts/src/` — Express REST server
- `sdk/sdk/src/` — CoralClient HTTP wrapper
- `web/` — Next.js marketplace
- `coral-agents/buyer-agent/src/` — autonomous buyer agent
- `coral-agents/seller-agent/src/` — autonomous seller agent
- `coral-agents/helius_monitor/agent.py` — Python wallet monitor

## Changes by File

### sdk/agent-core-ts/src/

| File | Change |
|------|--------|
| `manager.ts` | **Fix:** remove duplicate internal `IdleStrategy` class (dead code); import from `./strategies/idle.js` instead. Add JSDoc to class and all methods. |
| `agent.ts` | Add JSDoc to class, constructor, and all public methods. |
| `types.ts` | Add JSDoc to every interface and field. |
| `message_bus.ts` | Add JSDoc to class and methods; document `MAX_MESSAGES` capacity reason. |
| `shared_state.ts` | Add JSDoc to class and methods; document `MAX_HISTORY` cap. |
| `workflow.ts` | Add JSDoc to class and all mutating methods. |
| `role.ts` | Add JSDoc to enum, `RolePermissions`, and `getPermissions`. |
| `sync.ts` | Add JSDoc to class and `attach`/`detach` methods. |
| `strategy.ts` | Minor: add `@param`/`@returns` to `untilAborted`. |

### sdk/agent-core-ts/src/strategies/

| File | Change |
|------|--------|
| `idle.ts` | Add JSDoc. |
| `rpc_poll.ts` | Add JSDoc; document `intervalMs` param. |
| `helius_monitor.ts` | Add JSDoc; document config fields; explain `rpcUrl()`/`wsUrl()`. |
| `transfer.ts` | Add JSDoc; document `handleMessage` input format. |
| `payment.ts` | Add JSDoc; fix: `run()` sleep must respect abort signal. |
| `weather.ts` | Add JSDoc; document `fetchWeather` input formats and geocoding. |

### api-ts/src/

| File | Change |
|------|--------|
| `app.ts` | Add JSDoc header; document each route group; fix stale "cd api && cargo run" error text. |
| `registry.ts` | Add JSDoc; fix stale `typescript_sdk` comment. |

### sdk/sdk/src/

| File | Change |
|------|--------|
| `client.ts` | Add JSDoc to `CoralClient` class, `req`, and all public methods. |
| `types.ts` | Add JSDoc to every interface; note duplication with agent-core-ts is intentional for portability. |

### web/

| File | Change |
|------|--------|
| `app/result/[txSig]/page.tsx` | Fix: "cd api && cargo run" → "cd api-ts && npm run dev". |
| `app/pay/[agentId]/page.tsx` | Document `TxStatus` state machine; add comment on `AGENT_META`. |
| `app/page.tsx` | Add comment on `LISTINGS` shape. |
| `components/AgentCard.tsx` | Add JSDoc to `AgentListing` interface. |
| `components/WalletProvider.tsx` | Add comment on `HELIUS_DEVNET` env var. |

### coral-agents/

| File | Change |
|------|--------|
| `buyer-agent/src/wallet.ts` | Add JSDoc to `loadKeypair`; explain base58 decode. |
| `buyer-agent/src/index.ts` | Add module-level JSDoc describing the purchase loop. |
| `seller-agent/src/payment.ts` | Add JSDoc to `verifyPayment`; explain `as any` cast for versioned tx. |
| `seller-agent/src/index.ts` | Add module-level JSDoc describing command routing. |
| `helius_monitor/agent.py` | Fix docstring: remove Tauri reference, update "standalone" description. |

## Execution Order

1. Core SDK types and primitives (`types.ts`, `role.ts`, `strategy.ts`)
2. Core SDK data structures (`message_bus.ts`, `shared_state.ts`, `workflow.ts`)
3. Agent and manager (`agent.ts`, `manager.ts` — with IdleStrategy fix)
4. Strategies (`idle.ts`, `rpc_poll.ts`, `helius_monitor.ts`, `transfer.ts`, `payment.ts`, `weather.ts`)
5. Sync bridge (`sync.ts`)
6. API server (`api-ts/src/app.ts`, `api-ts/src/registry.ts`)
7. SDK client (`sdk/sdk/src/client.ts`, `sdk/sdk/src/types.ts`)
8. Web app (`web/` files)
9. Coral agents (`coral-agents/` TypeScript and Python files)
