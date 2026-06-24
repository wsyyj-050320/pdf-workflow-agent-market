# Completeness Plan — Fork-Ready Hackathon Starter

Full fix list from the completeness audit. Ordered so each phase unblocks the next.
No phase is optional if the goal is a fully forkable, testable, dockerised repo.

---

## Phase 1 — Make It Runnable (Foundation)

Students currently can't follow the README or run CI. Fix these first.

### 1.1 Fix README.md

Every quickstart command and the monorepo table reference directories that no longer exist (`agent_demo/`, `coral-server/`, `sdk/`). Replace the entire Quick Start and Monorepo Layout sections.

**Monorepo table — replace with:**

| Directory | Purpose |
|-----------|---------|
| `runtime/agent-core/` | Rust library: agent lifecycle, Solana Pay, Helius, CoralOS MCP |
| `runtime/coral-agents/` | Python agents: helius_monitor, user_proxy |
| `api/` | Axum REST API wrapping agent-core (port 8080) |
| `api-ts/` | Express REST API wrapping TypeScript strategies (port 8081) |
| `sdk/agent-core-ts/` | TypeScript agent runtime mirroring Rust agent-core |
| `sdk/sdk/` | CoralClient HTTP wrapper for api/ |
| `web/` | Next.js consumer marketplace — Phantom wallet payment flow |
| `docs/` | Design documents, CoralOS reference config, this plan |

**Quick start — replace with four working entry points:**

```sh
# Entry point 1: Rust API + web frontend
cd api && cargo run                        # terminal 1 — port 8080
cd web && npm install && npm run dev       # terminal 2 — port 3000

# Entry point 2: TypeScript API + web frontend
cd api-ts && npm install && npm run dev    # terminal 1 — port 8081
# set NEXT_PUBLIC_CORAL_SERVER=http://localhost:8081 in web/.env.local
cd web && npm install && npm run dev       # terminal 2 — port 3000

# Entry point 3: Rust API only (headless)
cd api && cargo run
curl http://localhost:8080/health

# Entry point 4: Python helius monitor (standalone)
cd runtime/coral-agents/helius_monitor
pip install -r requirements.txt
python agent.py --wallet <PUBKEY> --amount 0.001
```

**Environment setup — add explicit section:**

```sh
# Required: Helius API key (free at helius.dev)
cp .env.example .env
# Edit .env and set HELIUS_API_KEY=your_key_here

# Required for web frontend
cp web/.env.local.example web/.env.local
# Edit web/.env.local:
#   NEXT_PUBLIC_CORAL_SERVER=http://localhost:8080
#   NEXT_PUBLIC_HELIUS_API_KEY=your_key_here
```

---

### 1.2 Remove `sdk/` Duplicate

`sdk/` is an exact duplicate of `sdk/`. Having both confuses students and causes import ambiguity.

**Steps:**
1. Verify `sdk/` and `sdk/` are identical: `diff -r sdk/ sdk/`
2. Delete `sdk/` entirely
3. Grep all files for any import referencing `typescript_sdk` and update to `sdk`
4. Update any README references

**Files likely to reference it:**
- `api-ts/src/` imports
- Any `tsconfig.json` path aliases
- Root README monorepo table (fixed in 1.1)

---

### 1.3 Fix docker-compose Path

`docs/coral/docker-compose.yml` line 19 references `../runtime/coral-agents` which no longer exists.

**Fix:** Change to `../../runtime/coral-agents`

```yaml
# Before
volumes:
  - ../runtime/coral-agents/helius_monitor:/agent

# After
volumes:
  - ../../runtime/coral-agents/helius_monitor:/agent
```

---

### 1.4 Fix Python Agent Dependencies

**`runtime/coral-agents/helius_monitor/requirements.txt`** — currently only lists `websockets`. The coral mode requires `mcp`. Fix:

```
websockets>=12.0
mcp>=1.0.0
```

**`runtime/coral-agents/user_proxy/requirements.txt`** — does not exist at all. Create it:

```
mcp>=1.0.0
```

---

### 1.5 Add Missing `.env` Files

**`api-ts/.env.example`** — does not exist. Create:

```sh
PORT=8081
HELIUS_API_KEY=your_helius_api_key_here
SOLANA_RPC_URL=https://api.devnet.solana.com
```

**`web/.env.local.example`** — check it exists and covers all vars used in the code:

```sh
NEXT_PUBLIC_CORAL_SERVER=http://localhost:8080
NEXT_PUBLIC_HELIUS_API_KEY=your_helius_api_key_here
NEXT_PUBLIC_SOLANA_NETWORK=devnet
```

Cross-reference: grep `process.env.NEXT_PUBLIC_` across `web/` and confirm every key is in `.env.local.example`.

---

### 1.6 Fix or Replace CI

`.github/workflows/ci.yml` references `./typescript/`, `./rust/`, `./pdb` — none exist. Replace entirely.

**`.github/workflows/ci.yml`** — replace with:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  rust:
    name: Rust (agent-core + api)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - name: Build agent-core
        run: cd runtime && cargo build
      - name: Test agent-core
        run: cd runtime && cargo test
      - name: Build api
        run: cd api && cargo build
      - name: Test api
        run: cd api && cargo test
      - name: Clippy
        run: cd runtime && cargo clippy --workspace --all-targets -- -D warnings

  typescript:
    name: TypeScript (sdk + api-ts)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install sdk deps
        run: cd sdk/agent-core-ts && npm install
      - name: Typecheck sdk
        run: cd sdk/agent-core-ts && npm run typecheck
      - name: Install api-ts deps
        run: cd api-ts && npm install
      - name: Typecheck api-ts
        run: cd api-ts && npm run typecheck
      - name: Test api-ts
        run: cd api-ts && npm test

  web:
    name: Web (Next.js)
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Install deps
        run: cd web && npm install
      - name: Typecheck
        run: cd web && npm run typecheck
      - name: Build
        run: cd web && npm run build
        env:
          NEXT_PUBLIC_CORAL_SERVER: http://localhost:8080
          NEXT_PUBLIC_HELIUS_API_KEY: test

  e2e:
    name: E2E (Playwright)
    runs-on: ubuntu-latest
    needs: [rust, typescript, web]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
      - name: Install Playwright
        run: cd e2e && npm install && npx playwright install --with-deps chromium
      - name: Start api
        run: cd api && cargo run &
        env:
          HELIUS_API_KEY: ${{ secrets.HELIUS_API_KEY }}
      - name: Start web
        run: cd web && npm install && npm run build && npm run start &
        env:
          NEXT_PUBLIC_CORAL_SERVER: http://localhost:8080
      - name: Wait for services
        run: npx wait-on http://localhost:8080/health http://localhost:3000
      - name: Run E2E tests
        run: cd e2e && npx playwright test
```

Delete the other broken workflow files (`docker.yml`, `npm-publish.yml`, `release-cli.yml`, `report.yml`) unless they are actively maintained.

---

## Phase 2 — Unit Tests

Each runtime needs its own test suite before e2e is meaningful.

### 2.1 Rust Unit Tests — `runtime/agent-core/`

Add `#[cfg(test)]` blocks to existing modules. Minimum coverage:

**`src/solana_pay/url.rs`** — test encode/parse round trips:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_transfer_url_minimal() {
        let fields = TransferUrlFields {
            recipient: "7xKF9fN1p1mZNKMHzrtxA7WLjEMnmk6Rw6h8Pm8Ff9z".into(),
            amount: Some(0.001),
            spl_token: None, reference: None,
            label: None, message: None, memo: None,
        };
        let url = encode_transfer_url(&fields);
        assert!(url.starts_with("solana:"));
        assert!(url.contains("amount=0.001"));
    }

    #[test]
    fn encode_transfer_url_with_spl_token() {
        let fields = TransferUrlFields {
            recipient: "7xKF9fN1p1mZNKMHzrtxA7WLjEMnmk6Rw6h8Pm8Ff9z".into(),
            amount: Some(1.0),
            spl_token: Some("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU".into()),
            reference: None, label: None, message: None, memo: None,
        };
        let url = encode_transfer_url(&fields);
        assert!(url.contains("spl-token="));
    }

    #[test]
    fn parse_transfer_url_round_trip() {
        let original = "solana:7xKF9fN1p1mZNKMHzrtxA7WLjEMnmk6Rw6h8Pm8Ff9z?amount=0.001&label=Test";
        let parsed = parse_url(original).unwrap();
        match parsed {
            ParsedUrl::Transfer(f) => {
                assert_eq!(f.amount, Some(0.001));
                assert_eq!(f.label.as_deref(), Some("Test"));
            }
            _ => panic!("expected transfer"),
        }
    }

    #[test]
    fn parse_transaction_request_url() {
        let url = "solana:https%3A%2F%2Fapi.example.com%2Fpay?label=Shop";
        let parsed = parse_url(url).unwrap();
        assert!(matches!(parsed, ParsedUrl::Transaction(_)));
    }

    #[test]
    fn parse_url_rejects_wrong_scheme() {
        assert!(parse_url("https://not-solana.com").is_err());
    }
}
```

**`src/solana_pay/payment.rs`** — test 402 parsing:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_x402_challenge() {
        let header = r#"{"scheme":"solana","requirements":{"amount":"1000","currency":"USDC","recipient":"7xKF9fN1p1mZNKMHzrtxA7WLjEMnmk6Rw6h8Pm8Ff9z"}}"#;
        let headers = vec![("x-payment-required".into(), header.into())];
        let challenge = parse_402_response(&headers).unwrap();
        assert_eq!(challenge.protocol, PaymentProtocol::X402);
        assert_eq!(challenge.amount, 1000);
        assert_eq!(challenge.token, "USDC");
    }

    #[test]
    fn parse_402_response_returns_none_for_200() {
        let headers = vec![("content-type".into(), "application/json".into())];
        assert!(parse_402_response(&headers).is_none());
    }
}
```

**`src/shared_state.rs`** — test key-value operations:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn set_and_get_entry() {
        let state = SharedState::new();
        state.set("price", "189.42", Some("agent-1"));
        let entry = state.get("price").unwrap();
        assert_eq!(entry.value, "189.42");
        assert_eq!(entry.set_by, Some("agent-1".into()));
        assert_eq!(entry.version, 1);
    }

    #[test]
    fn version_increments_on_update() {
        let state = SharedState::new();
        state.set("key", "v1", None);
        state.set("key", "v2", None);
        assert_eq!(state.get("key").unwrap().version, 2);
    }

    #[test]
    fn get_missing_key_returns_none() {
        let state = SharedState::new();
        assert!(state.get("nonexistent").is_none());
    }
}
```

**`src/message_bus.rs`** — test broadcast:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn broadcast_reaches_subscriber() {
        let bus = MessageBus::new();
        let mut rx = bus.subscribe();
        bus.publish(AgentMessage {
            from: "agent-a".into(),
            to: None,
            content: "hello".into(),
        });
        let msg = rx.recv().await.unwrap();
        assert_eq!(msg.content, "hello");
    }
}
```

**`src/strategy.rs`** — test default handle_message:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

    #[tokio::test]
    async fn default_handle_message_echoes() {
        let strategy = IdleStrategy::new();
        let state = Arc::new(Mutex::new(AgentState::default()));
        let reply = strategy.handle_message("ping", state).await;
        assert!(reply.contains("ping"));
    }
}
```

---

### 2.2 TypeScript Unit Tests — `sdk/agent-core-ts/`

Add Vitest. Install:

```sh
cd sdk/agent-core-ts && npm install --save-dev vitest
```

Add to `package.json`:
```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest"
}
```

**`src/__tests__/shared_state.test.ts`**:

```typescript
import { describe, it, expect } from 'vitest'
import { SharedState } from '../shared_state.js'

describe('SharedState', () => {
  it('sets and gets a value', () => {
    const state = new SharedState()
    state.set('price', '189.42', 'agent-1')
    const entry = state.get('price')
    expect(entry?.value).toBe('189.42')
    expect(entry?.version).toBe(1)
  })

  it('increments version on update', () => {
    const state = new SharedState()
    state.set('key', 'v1')
    state.set('key', 'v2')
    expect(state.get('key')?.version).toBe(2)
  })

  it('returns undefined for missing key', () => {
    const state = new SharedState()
    expect(state.get('missing')).toBeUndefined()
  })
})
```

**`src/__tests__/message_bus.test.ts`**:

```typescript
import { describe, it, expect } from 'vitest'
import { MessageBus } from '../message_bus.js'

describe('MessageBus', () => {
  it('delivers message to subscriber', async () => {
    const bus = new MessageBus()
    const received: string[] = []
    bus.subscribe((msg) => received.push(msg.content))
    bus.publish({ from: 'a', to: undefined, content: 'hello' })
    expect(received).toContain('hello')
  })
})
```

---

### 2.3 TypeScript Unit Tests — `api-ts/`

Install Vitest and supertest:

```sh
cd api-ts && npm install --save-dev vitest supertest @types/supertest
```

Add to `package.json`:
```json
"scripts": {
  "test": "vitest run"
}
```

**`src/__tests__/health.test.ts`**:

```typescript
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'

describe('GET /health', () => {
  it('returns 200', async () => {
    const app = createApp()
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('ok')
  })
})
```

**`src/__tests__/agents.test.ts`**:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../app.js'

describe('Agents API', () => {
  let app: ReturnType<typeof createApp>

  beforeEach(() => { app = createApp() })

  it('GET /api/v1/agents returns empty array initially', async () => {
    const res = await request(app).get('/api/v1/agents')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })

  it('POST /api/v1/agents creates an agent', async () => {
    const res = await request(app)
      .post('/api/v1/agents')
      .send({ id: 'test-agent', strategy: 'idle' })
    expect(res.status).toBe(200)
    expect(res.body.id).toBe('test-agent')
  })

  it('GET /api/v1/agents/:id returns created agent', async () => {
    await request(app).post('/api/v1/agents').send({ id: 'agent-x' })
    const res = await request(app).get('/api/v1/agents/agent-x')
    expect(res.status).toBe(200)
  })
})
```

---

### 2.4 Rust API Integration Tests — `api/`

Add `tests/` directory to `api/`:

**`api/tests/health.rs`**:

```rust
use axum_test::TestServer;

#[tokio::test]
async fn health_returns_ok() {
    let app = api::create_app();
    let server = TestServer::new(app).unwrap();
    let res = server.get("/health").await;
    res.assert_status_ok();
}
```

**`api/tests/agents.rs`**:

```rust
#[tokio::test]
async fn create_and_list_agents() {
    let server = TestServer::new(api::create_app()).unwrap();

    // Create
    let res = server
        .post("/api/v1/agents")
        .json(&serde_json::json!({ "id": "test-agent", "strategy": "idle" }))
        .await;
    res.assert_status_ok();

    // List
    let res = server.get("/api/v1/agents").await;
    res.assert_status_ok();
    let agents: Vec<serde_json::Value> = res.json();
    assert!(agents.iter().any(|a| a["id"] == "test-agent"));
}

#[tokio::test]
async fn shared_state_set_and_get() {
    let server = TestServer::new(api::create_app()).unwrap();

    server
        .put("/api/v1/state")
        .json(&serde_json::json!({ "key": "price", "value": "189.42" }))
        .await
        .assert_status_ok();

    let res = server.get("/api/v1/state?key=price").await;
    res.assert_status_ok();
    let entry: serde_json::Value = res.json();
    assert_eq!(entry["value"], "189.42");
}
```

Add to `api/Cargo.toml`:
```toml
[dev-dependencies]
axum-test = "0.4"
tokio = { version = "1", features = ["full"] }
serde_json = "1"
```

Refactor `api/src/main.rs` to expose `create_app() -> Router` so tests can import it without spawning a server.

---

## Phase 3 — Docker

### 3.1 Dockerfile for `api/` (Rust)

**`api/Dockerfile`**:

```dockerfile
FROM rust:1.78 AS builder
WORKDIR /build
COPY runtime/agent-core ./runtime/agent-core
COPY api ./api
WORKDIR /build/api
RUN cargo build --release

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /build/api/target/release/coral-server /usr/local/bin/coral-server
EXPOSE 8080
CMD ["coral-server"]
```

---

### 3.2 Dockerfile for `api-ts/` (Node.js)

**`api-ts/Dockerfile`**:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY api-ts/package*.json ./
RUN npm ci
COPY api-ts/src ./src
COPY api-ts/tsconfig.json ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 8081
CMD ["node", "dist/index.js"]
```

---

### 3.3 Dockerfile for `web/` (Next.js)

**`web/Dockerfile`**:

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY web/package*.json ./
RUN npm ci
COPY web .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]
```

---

### 3.4 Full-Stack `docker-compose.yml`

**Root `docker-compose.yml`**:

```yaml
version: "3.9"

services:
  # ── Rust REST API ───────────────────────────────────────────────
  api:
    build:
      context: .
      dockerfile: api/Dockerfile
    ports:
      - "8080:8080"
    environment:
      HELIUS_API_KEY: ${HELIUS_API_KEY}
      RUST_LOG: info
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8080/health"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ── TypeScript REST API ─────────────────────────────────────────
  api-ts:
    build:
      context: .
      dockerfile: api-ts/Dockerfile
    ports:
      - "8081:8081"
    environment:
      HELIUS_API_KEY: ${HELIUS_API_KEY}
      PORT: 8081
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8081/health"]
      interval: 10s
      timeout: 5s
      retries: 5

  # ── Next.js web frontend ────────────────────────────────────────
  web:
    build:
      context: .
      dockerfile: web/Dockerfile
    ports:
      - "3000:3000"
    environment:
      NEXT_PUBLIC_CORAL_SERVER: http://api:8080
      NEXT_PUBLIC_HELIUS_API_KEY: ${HELIUS_API_KEY}
    depends_on:
      api:
        condition: service_healthy

  # ── CoralOS swarm server ────────────────────────────────────────
  coralos:
    image: coralprotocol/coral-server:latest
    ports:
      - "5555:5555"
    volumes:
      - ./docs/coral/config.toml:/app/config.toml:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:5555/health"]
      interval: 10s
      timeout: 5s
      retries: 10

  # ── Helius monitor Python agent ─────────────────────────────────
  helius-monitor:
    build:
      context: runtime/coral-agents/helius_monitor
    environment:
      CORAL_CONNECTION_URL: ${CORAL_CONNECTION_URL:-}
      HELIUS_API_KEY: ${HELIUS_API_KEY}
      WALLET: ${MONITOR_WALLET:-}
      AMOUNT_SOL: ${MONITOR_AMOUNT:-0.001}
    depends_on:
      coralos:
        condition: service_healthy
    profiles:
      - coral   # only starts when: docker compose --profile coral up
```

**Usage:**

```sh
# Minimal stack (api + web only)
docker compose up api web

# Full stack including CoralOS
docker compose --profile coral up

# Full stack with TypeScript API instead
NEXT_PUBLIC_CORAL_SERVER=http://api-ts:8081 docker compose up api-ts web
```

---

## Phase 4 — Wire Web Frontend

`web/app/page.tsx` currently hardcodes a single agent. Make it dynamic.

### 4.1 Agent listing from API

Replace the hardcoded agent list with a fetch from `NEXT_PUBLIC_CORAL_SERVER/api/v1/agents`:

```typescript
// web/lib/api.ts
const BASE = process.env.NEXT_PUBLIC_CORAL_SERVER ?? 'http://localhost:8080'

export async function listAgents() {
  const res = await fetch(`${BASE}/api/v1/agents`, { cache: 'no-store' })
  if (!res.ok) throw new Error('Failed to fetch agents')
  return res.json()
}

export async function getSharedState(key: string) {
  const res = await fetch(`${BASE}/api/v1/state?key=${key}`, { cache: 'no-store' })
  if (!res.ok) return null
  return res.json()
}
```

Update `web/app/page.tsx` to call `listAgents()` in a Server Component.

### 4.2 Payment flow pages

`/pay/[agentId]` and `/result/[txSig]` pages need to be verified complete. At minimum each page must:
- `/pay/[agentId]` — show agent details fetched from API, Phantom connect button, pay button that constructs a Solana Pay URL or transaction request
- `/result/[txSig]` — call `validate_transfer` via API, show confirmation or error

### 4.3 Add typecheck script to web

```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "typecheck": "tsc --noEmit"
}
```

---

## Phase 5 — End-to-End Tests

Create a new top-level `e2e/` directory. Uses Playwright for browser tests and a custom harness for API flow tests.

### 5.1 Setup

```sh
mkdir e2e && cd e2e
npm init -y
npm install --save-dev @playwright/test
npx playwright install chromium
```

**`e2e/package.json`** scripts:
```json
{
  "scripts": {
    "test": "playwright test",
    "test:headed": "playwright test --headed",
    "test:api": "playwright test --grep @api",
    "test:ui": "playwright test --grep @ui"
  }
}
```

**`e2e/playwright.config.ts`**:

```typescript
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
  },
  webServer: [
    {
      command: 'cd ../api && cargo run',
      url: 'http://localhost:8080/health',
      timeout: 60_000,
      reuseExistingServer: true,
    },
    {
      command: 'cd ../web && npm run start',
      url: 'http://localhost:3000',
      timeout: 30_000,
      reuseExistingServer: true,
    },
  ],
})
```

---

### 5.2 API Flow Tests (no browser)

**`e2e/tests/api-agents.spec.ts`** — tagged `@api`:

```typescript
import { test, expect } from '@playwright/test'

const API = 'http://localhost:8080'

test.describe('Agent lifecycle @api', () => {
  test('create, start, stop, delete agent', async ({ request }) => {
    // Create
    const create = await request.post(`${API}/api/v1/agents`, {
      data: { id: 'e2e-agent', strategy: 'idle' }
    })
    expect(create.ok()).toBe(true)
    const agent = await create.json()
    expect(agent.id).toBe('e2e-agent')

    // Start
    const start = await request.post(`${API}/api/v1/agents/e2e-agent/start`)
    expect(start.ok()).toBe(true)

    // Poll until running
    await expect.poll(async () => {
      const s = await request.get(`${API}/api/v1/agents/e2e-agent`)
      return (await s.json()).is_running
    }, { timeout: 5000 }).toBe(true)

    // Stop
    const stop = await request.post(`${API}/api/v1/agents/e2e-agent/stop`)
    expect(stop.ok()).toBe(true)

    // Delete
    const del = await request.delete(`${API}/api/v1/agents/e2e-agent`)
    expect(del.ok()).toBe(true)
  })
})
```

**`e2e/tests/api-shared-state.spec.ts`** — tagged `@api`:

```typescript
import { test, expect } from '@playwright/test'

const API = 'http://localhost:8080'

test.describe('Shared state @api', () => {
  test('write and read back', async ({ request }) => {
    const put = await request.put(`${API}/api/v1/state`, {
      data: { key: 'e2e-test', value: 'hello-world' }
    })
    expect(put.ok()).toBe(true)

    const get = await request.get(`${API}/api/v1/state?key=e2e-test`)
    expect(get.ok()).toBe(true)
    const entry = await get.json()
    expect(entry.value).toBe('hello-world')
  })

  test('version increments on repeated writes', async ({ request }) => {
    for (let i = 1; i <= 3; i++) {
      await request.put(`${API}/api/v1/state`, {
        data: { key: 'e2e-version', value: `v${i}` }
      })
    }
    const get = await request.get(`${API}/api/v1/state?key=e2e-version`)
    const entry = await get.json()
    expect(entry.version).toBe(3)
  })
})
```

**`e2e/tests/api-payment-flow.spec.ts`** — tagged `@api`:

```typescript
import { test, expect } from '@playwright/test'

const API = 'http://localhost:8080'

test.describe('Payment flow @api', () => {
  test('Solana Pay URL generation', async ({ request }) => {
    const res = await request.post(`${API}/api/v1/solana-pay/url`, {
      data: {
        recipient: '7xKF9fN1p1mZNKMHzrtxA7WLjEMnmk6Rw6h8Pm8Ff9z',
        amount: 0.001,
        label: 'E2E Test'
      }
    })
    expect(res.ok()).toBe(true)
    const { url } = await res.json()
    expect(url).toMatch(/^solana:/)
    expect(url).toContain('amount=0.001')
  })

  test('HTTP 402 demo flow against sandbox endpoint', async ({ request }) => {
    const res = await request.post(`${API}/api/v1/pay-demo`, {
      data: {
        endpoint: 'https://debugger.pay.sh/mpp/quote/AAPL',
        budget: 1_000_000
      }
    })
    expect(res.ok()).toBe(true)
    const result = await res.json()
    // Should detect the 402 challenge even without real signing
    expect(result.challenge).toBeTruthy()
    expect(['mpp', 'x402']).toContain(result.challenge.protocol)
  })

  test('validate_transfer rejects malformed signature', async ({ request }) => {
    const res = await request.post(`${API}/api/v1/payments/validate`, {
      data: { signature: 'not-a-real-sig', recipient: '7xKF9fN1p1mZNKMHzrtxA7WLjEMnmk6Rw6h8Pm8Ff9z' }
    })
    expect(res.ok()).toBe(true)
    const result = await res.json()
    expect(result.valid).toBe(false)
    expect(result.error).toBeTruthy()
  })
})
```

**`e2e/tests/api-workflow.spec.ts`** — tagged `@api`:

```typescript
import { test, expect } from '@playwright/test'

const API = 'http://localhost:8080'

test.describe('Workflow engine @api', () => {
  test('create and trigger a two-step workflow', async ({ request }) => {
    // Create two agents
    await request.post(`${API}/api/v1/agents`, { data: { id: 'wf-agent-a', strategy: 'idle' } })
    await request.post(`${API}/api/v1/agents`, { data: { id: 'wf-agent-b', strategy: 'idle' } })

    // Create workflow
    const wf = await request.post(`${API}/api/v1/workflows`, {
      data: {
        id: 'e2e-workflow',
        steps: [
          { id: 'step-1', agent_id: 'wf-agent-a', depends_on: [] },
          { id: 'step-2', agent_id: 'wf-agent-b', depends_on: ['step-1'] },
        ]
      }
    })
    expect(wf.ok()).toBe(true)

    // Trigger
    const trigger = await request.post(`${API}/api/v1/workflows/e2e-workflow/trigger`)
    expect(trigger.ok()).toBe(true)
  })
})
```

---

### 5.3 UI Tests (browser)

**`e2e/tests/ui-home.spec.ts`** — tagged `@ui`:

```typescript
import { test, expect } from '@playwright/test'

test.describe('Home page @ui', () => {
  test('loads and shows agent listing', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/pay|agent|marketplace/i)
    // Agent cards should appear
    await expect(page.locator('[data-testid="agent-card"]').first()).toBeVisible({ timeout: 10_000 })
  })

  test('shows price in SOL for each agent', async ({ page }) => {
    await page.goto('/')
    const priceText = page.locator('[data-testid="agent-price"]').first()
    await expect(priceText).toContainText('SOL')
  })
})
```

**`e2e/tests/ui-payment-flow.spec.ts`** — tagged `@ui`:

```typescript
import { test, expect } from '@playwright/test'

test.describe('Payment flow @ui', () => {
  test('navigates to pay page from marketplace', async ({ page }) => {
    await page.goto('/')
    await page.locator('[data-testid="agent-card"]').first().click()
    await expect(page).toHaveURL(/\/pay\//)
  })

  test('pay page shows connect wallet prompt without wallet', async ({ page }) => {
    await page.goto('/pay/weather-agent')
    await expect(page.locator('[data-testid="connect-wallet"]')).toBeVisible()
  })

  test('result page handles invalid tx signature gracefully', async ({ page }) => {
    await page.goto('/result/invalid-sig-12345')
    await expect(page.locator('[data-testid="error-message"]')).toBeVisible()
  })
})
```

Add `data-testid` attributes to the relevant Next.js components as you implement these tests.

---

### 5.4 CoralOS Integration Tests

These require CoralOS Docker running. Run separately: `npm run test -- --grep @coral`.

**`e2e/tests/coralos-mcp.spec.ts`** — tagged `@coral`:

```typescript
import { test, expect } from '@playwright/test'

const API = 'http://localhost:8080'
const CORAL = 'http://localhost:5555'

test.describe('CoralOS MCP integration @coral', () => {
  test.skip(!process.env.CORAL_ENABLED, 'Set CORAL_ENABLED=1 to run coral tests')

  test('agent joins CoralOS session and receives mention', async ({ request }) => {
    // Create a local agent
    await request.post(`${API}/api/v1/agents`, { data: { id: 'coral-test-agent', strategy: 'idle' } })

    // Join the swarm
    const join = await request.post(`${API}/api/v1/coralos/mcp/join`, {
      data: {
        connection_url: `${CORAL}/mcp`,
        agent_name: 'coral-test-agent'
      }
    })
    expect(join.ok()).toBe(true)

    // Verify active
    await expect.poll(async () => {
      const s = await request.get(`${API}/api/v1/coralos/mcp/status/coral-test-agent`)
      return s.json()
    }, { timeout: 10_000 }).toBe(true)
  })
})
```

---

## Phase 6 — Cleanup

### 6.1 Delete stale workflow files

```
.github/workflows/docker.yml       → delete
.github/workflows/npm-publish.yml  → delete
.github/workflows/release-cli.yml  → delete
.github/workflows/report.yml       → delete
```

Keep only the new `ci.yml` from Phase 1.6.

### 6.2 Update `runtime/README.md`

All Tauri/`src-tauri`/`src-ui` references have been removed. Current structure uses `api/`, `api-ts/`, `runtime/`, `sdk/`, and `web/`.

### 6.3 Update `api/CLAUDE.md`

The path dependency entry still says `../runtime/agent-core`. Update to `../runtime/agent-core`.

### 6.4 Add `web/app/page.tsx` data-testid attributes

Every component the E2E tests reference needs a `data-testid`. Add to:
- Agent card: `data-testid="agent-card"`
- Agent price: `data-testid="agent-price"`
- Connect wallet button: `data-testid="connect-wallet"`
- Error message: `data-testid="error-message"`

---

## Completion Checklist

| Area | Done |
|------|------|
| README paths corrected | ☐ |
| `sdk/` removed | ☐ |
| docker-compose.yml path fixed | ☐ |
| Python requirements.txt fixed | ☐ |
| `.env.example` files complete | ☐ |
| CI workflow replaced | ☐ |
| Rust unit tests — url.rs | ☐ |
| Rust unit tests — payment.rs | ☐ |
| Rust unit tests — shared_state.rs | ☐ |
| Rust unit tests — message_bus.rs | ☐ |
| Rust unit tests — strategy.rs | ☐ |
| Rust API integration tests | ☐ |
| TypeScript unit tests — sdk | ☐ |
| TypeScript unit tests — api-ts | ☐ |
| api/Dockerfile | ☐ |
| api-ts/Dockerfile | ☐ |
| web/Dockerfile | ☐ |
| Root docker-compose.yml | ☐ |
| Web frontend agent listing dynamic | ☐ |
| Web frontend pay/result pages complete | ☐ |
| Web typecheck script added | ☐ |
| e2e/ directory created | ☐ |
| E2E API flow tests | ☐ |
| E2E UI tests | ☐ |
| E2E CoralOS tests | ☐ |
| Stale CI workflow files deleted | ☐ |
| data-testid attributes added to web | ☐ |

---

## Estimated effort

| Phase | Files touched | Effort |
|-------|--------------|--------|
| 1 — Foundation | ~10 | 2–3 hours |
| 2 — Unit tests | ~15 new test files | 4–6 hours |
| 3 — Docker | 4 new files | 1–2 hours |
| 4 — Web frontend | ~5 files | 2–4 hours |
| 5 — E2E tests | ~6 new test files | 3–5 hours |
| 6 — Cleanup | ~5 files | 30 min |
| **Total** | **~45 files** | **~1.5–2 days** |
