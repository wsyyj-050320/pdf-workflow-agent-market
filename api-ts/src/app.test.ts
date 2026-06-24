import { describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import app from './app.js'

describe('GET /health', () => {
  it('returns healthy', async () => {
    const res = await request(app).get('/health')
    expect(res.status).toBe(200)
    expect(res.body.status).toBe('healthy')
    expect(res.body.runtime).toBe('node')
  })
})

describe('GET /api/v1/agents', () => {
  it('returns an array', async () => {
    const res = await request(app).get('/api/v1/agents')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})

describe('POST /api/v1/agents', () => {
  it('creates an agent and returns 201', async () => {
    const id = `test-${Date.now()}`
    const res = await request(app)
      .post('/api/v1/agents')
      .send({ id, strategy: 'idle' })
    expect(res.status).toBe(201)
    expect(res.body.id).toBe(id)
  })

  it('returns 400 when id is missing', async () => {
    const res = await request(app)
      .post('/api/v1/agents')
      .send({ strategy: 'idle' })
    expect(res.status).toBe(400)
  })

  it('returns 409 when agent id already exists', async () => {
    const id = `dup-${Date.now()}`
    await request(app).post('/api/v1/agents').send({ id, strategy: 'idle' })
    const res = await request(app)
      .post('/api/v1/agents')
      .send({ id, strategy: 'idle' })
    expect(res.status).toBe(409)
  })
})

describe('GET /api/v1/agents/:id', () => {
  it('returns 404 for unknown agent', async () => {
    const res = await request(app).get('/api/v1/agents/no-such-agent')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/v1/agents/:id/handle', () => {
  it('returns a reply string', async () => {
    const id = `handle-${Date.now()}`
    await request(app).post('/api/v1/agents').send({ id, strategy: 'idle' })
    const res = await request(app)
      .post(`/api/v1/agents/${id}/handle`)
      .send({ text: 'London' })
    expect(res.status).toBe(200)
    expect(typeof res.body.reply).toBe('string')
  })
})

describe('GET /api/v1/shared-state', () => {
  it('returns an object', async () => {
    const res = await request(app).get('/api/v1/shared-state')
    expect(res.status).toBe(200)
    expect(typeof res.body).toBe('object')
  })
})

describe('POST /api/v1/shared-state/:key', () => {
  it('sets a value', async () => {
    const res = await request(app)
      .post('/api/v1/shared-state/test-key')
      .send({ value: 'hello', changed_by: 'test' })
    expect(res.status).toBe(200)
    expect(res.body).toBe(true)
  })
})

describe('GET /api/v1/messages', () => {
  it('returns an array', async () => {
    const res = await request(app).get('/api/v1/messages')
    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
  })
})
