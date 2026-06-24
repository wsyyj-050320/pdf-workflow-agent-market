/**
 * @tag @api
 * API smoke tests — run against a live api/ server (port 8080).
 * These do NOT require a browser or Phantom wallet.
 *
 * Run standalone:
 *   cd e2e && npm test -- --grep @api
 */

import { test, expect, request } from '@playwright/test'

const API = process.env.API_URL ?? 'http://localhost:8080'

test.describe('@api Health', () => {
  test('GET /health returns status healthy', async () => {
    const ctx = await request.newContext({ baseURL: API })
    const res = await ctx.get('/health')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('healthy')
    await ctx.dispose()
  })
})

test.describe('@api Agents', () => {
  let ctx: Awaited<ReturnType<typeof request.newContext>>

  test.beforeAll(async () => {
    ctx = await request.newContext({ baseURL: API })
  })

  test.afterAll(async () => {
    await ctx.dispose()
  })

  test('GET /api/v1/agents returns array', async () => {
    const res = await ctx.get('/api/v1/agents')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })

  test('POST /api/v1/agents creates agent', async () => {
    const id = `e2e-agent-${Date.now()}`
    const res = await ctx.post('/api/v1/agents', {
      data: { id, strategy: 'idle' },
    })
    expect(res.status()).toBe(201)
    const body = await res.json()
    expect(body.id ?? body.strategy).toBeTruthy()

    // Verify it's retrievable
    const get = await ctx.get(`/api/v1/agents/${id}`)
    expect(get.status()).toBe(200)
  })

  test('POST /api/v1/agents with missing id returns 400', async () => {
    const res = await ctx.post('/api/v1/agents', {
      data: { strategy: 'idle' },
    })
    expect(res.status()).toBe(400)
  })

  test('GET /api/v1/agents/:id for unknown agent returns 404', async () => {
    const res = await ctx.get('/api/v1/agents/does-not-exist')
    expect(res.status()).toBe(404)
  })
})

test.describe('@api Shared State', () => {
  let ctx: Awaited<ReturnType<typeof request.newContext>>

  test.beforeAll(async () => {
    ctx = await request.newContext({ baseURL: API })
  })

  test.afterAll(async () => {
    await ctx.dispose()
  })

  test('POST /api/v1/shared-state/:key sets a value', async () => {
    const key = `e2e-key-${Date.now()}`
    const res = await ctx.post(`/api/v1/shared-state/${key}`, {
      data: { value: 'e2e-test', changed_by: 'playwright' },
    })
    expect(res.status()).toBe(200)
  })

  test('GET /api/v1/shared-state returns the set value', async () => {
    const key = `e2e-verify-${Date.now()}`
    await ctx.post(`/api/v1/shared-state/${key}`, {
      data: { value: 'hello', changed_by: 'playwright' },
    })
    const res = await ctx.get('/api/v1/shared-state')
    const body = await res.json()
    expect(body[key]?.value).toBe('hello')
  })
})

test.describe('@api Messages', () => {
  let ctx: Awaited<ReturnType<typeof request.newContext>>

  test.beforeAll(async () => {
    ctx = await request.newContext({ baseURL: API })
  })

  test.afterAll(async () => {
    await ctx.dispose()
  })

  test('POST /api/v1/messages broadcasts a message', async () => {
    const res = await ctx.post('/api/v1/messages', {
      data: { from: 'e2e', msg_type: 'ping', payload: 'test' },
    })
    expect(res.status()).toBe(200)
  })

  test('GET /api/v1/messages returns array', async () => {
    const res = await ctx.get('/api/v1/messages')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(Array.isArray(body)).toBe(true)
  })
})

test.describe('@api Weather', () => {
  test('POST /api/v1/weather with city returns data', async () => {
    const ctx = await request.newContext({ baseURL: API })
    const res = await ctx.post('/api/v1/weather', {
      data: { city: 'London' },
    })
    // The weather endpoint calls open-meteo; may be 200 or 500 in CI without internet
    expect([200, 500]).toContain(res.status())
    if (res.status() === 200) {
      const body = await res.json()
      expect(body.ok).toBe(true)
    }
    await ctx.dispose()
  })
})
