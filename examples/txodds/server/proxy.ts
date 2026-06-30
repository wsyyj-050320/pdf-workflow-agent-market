/**
 * Real-data proxy for the World Cup Oracle React app.
 *
 * The browser cannot hold the TxLINE API token or sign Solana transactions, so this tiny Node server
 * does it: on first request it subscribes the kit's buyer wallet to the free World Cup tier on devnet,
 * activates an API token, then serves live fixtures/odds to the React app (which only ever talks here).
 *
 * Verified working against devnet (2026-06). Two corrections vs. the published TxODDS examples:
 *   1. host is `txline-dev.txodds.com`           (the repo's `oracle-dev.txodds.com` does not resolve)
 *   2. mint is the treasury's `4Zao8o…`          (the IDL's `TXLINE_MINT` constant is stale -> InvalidMint)
 *
 * Run:  ANCHOR off — just `npx ts-node server/proxy.ts`  (reads BUYER_KEYPAIR_B58 from the repo .env)
 */
import http from 'node:http'
import fs from 'node:fs'
import axios from 'axios'
import * as anchor from '@coral-xyz/anchor'
import { PublicKey, SystemProgram, Keypair, Connection } from '@solana/web3.js'
import {
  TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount, getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import nacl from 'tweetnacl'
import bs58 from 'bs58'
import { fileURLToPath } from 'node:url'
import { assertDevnet } from '@pay/agent-runtime'
import { analyzeEdge } from '../agent/edge.js'
import { makeProgram, deposit, release, escrowPda } from '../agent/escrow.js'

const PROGRAM = new PublicKey('6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J')
const MINT = new PublicKey('4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG') // real treasury mint
const BASE = process.env.TXLINE_BASE_URL ?? 'https://txline-dev.txodds.com'
const RPC = process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com'
const PORT = Number(process.env.PORT ?? 8801)
// fileURLToPath (not .pathname) so the repo-root .env resolves on macOS/Linux too, not just Windows.
const ENV_PATH = process.env.KIT_ENV ?? fileURLToPath(new URL('../../../.env', import.meta.url))

// Pull LLM + seller keys from the repo .env so /api/edge can call the model and /api/settle can pay.
// (Existing process.env wins, so a shell override still takes precedence.)
;(function loadEnv() {
  try {
    for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* no .env — rely on the shell env */ }
})()

const expl = (kind: 'tx' | 'address', id: string) => `https://explorer.solana.com/${kind}/${id}?cluster=devnet`

function buyerKeypair(): Keypair {
  const txt = fs.readFileSync(ENV_PATH, 'utf8')
  const m = txt.match(/^BUYER_KEYPAIR_B58=(.+)$/m)
  if (!m) throw new Error(`BUYER_KEYPAIR_B58 not in ${ENV_PATH}`)
  return Keypair.fromSecretKey(bs58.decode(m[1].trim()))
}

let jwt = ''
let apiToken = ''

/** Subscribe (free tier) + activate, once. Caches the resulting API token. */
async function ensureToken(): Promise<void> {
  if (apiToken) return
  const keypair = buyerKeypair()
  assertDevnet(RPC) // devnet-only: refuse a mainnet RPC unless ALLOW_MAINNET=1
  const connection = new Connection(RPC, 'confirmed')
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(keypair), { commitment: 'confirmed' })
  const idl = (await anchor.Program.fetchIdl(PROGRAM, provider)) as anchor.Idl
  const program = new anchor.Program(idl, provider)

  jwt = (await axios.post(`${BASE}/auth/guest/start`)).data.token
  const ata = await getOrCreateAssociatedTokenAccount(
    connection, keypair, MINT, keypair.publicKey, false, 'confirmed', undefined, TOKEN_2022_PROGRAM_ID,
  )
  const [pricingMatrix] = PublicKey.findProgramAddressSync([Buffer.from('pricing_matrix')], PROGRAM)
  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync([Buffer.from('token_treasury_v2')], PROGRAM)
  const tokenTreasuryVault = getAssociatedTokenAddressSync(MINT, tokenTreasuryPda, true, TOKEN_2022_PROGRAM_ID)

  const txSig = await (program.methods as any)
    .subscribe(1, 4) // service level 1 (free World Cup), 4 weeks
    .accounts({
      user: keypair.publicKey, pricingMatrix, tokenMint: MINT, userTokenAccount: ata.address,
      tokenTreasuryVault, tokenTreasuryPda, tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .rpc()

  const msg = new TextEncoder().encode(`${txSig}::${jwt}`)
  const walletSignature = Buffer.from(nacl.sign.detached(msg, keypair.secretKey)).toString('base64')
  const data = (await axios.post(
    `${BASE}/api/token/activate`,
    { txSig, walletSignature, leagues: [] },
    { headers: { Authorization: `Bearer ${jwt}` } },
  )).data
  apiToken = data.token || data
  if (typeof apiToken !== 'string' || !apiToken) throw new Error('activation returned no token')
  console.error('[proxy] subscribed + activated — serving live TxODDS data')
}

async function txGet(path: string): Promise<unknown> {
  await ensureToken()
  const res = await axios.get(`${BASE}${path}`, {
    headers: { Authorization: `Bearer ${jwt}`, 'X-Api-Token': apiToken },
  })
  return res.data
}

// A market is real if it has at least one finite price (the live feed is full of rows priced "NA" we
// must NOT surface). A fixture is board-worthy if it has ANY such market — the free World Cup tier's
// 1X2 odds are intermittent, but over/under + Asian-handicap markets are usually present, and those
// are verified de-margined odds too. 1X2 fixtures are still preferred (sorted first) when available.
const hasFinitePrice = (m: any): boolean =>
  Array.isArray(m?.PriceNames) &&
  m.PriceNames.some((_: unknown, i: number) => Number.isFinite(Number((m.Pct || [])[i])))
const has1x2 = (odds: any[]): boolean =>
  odds.some((m) => String(m?.SuperOddsType ?? '').includes('1X2') && hasFinitePrice(m))

/**
 * The fixtures to actually show: those with any verified live market, odds inlined so the UI never has
 * to guess or fall back to demo numbers for a live game. 1X2 fixtures sort first. Cached briefly +
 * fetched with bounded concurrency so the board loads fast without hammering the upstream.
 */
// Cache holds the last NON-EMPTY board. We never cache an empty scan (the free tier flickers in and
// out of having priced markets); instead, when a scan comes back empty we keep serving the last good
// board for a few minutes so the UI stays live through the gaps.
let boardCache: { at: number; data: any[] } = { at: 0, data: [] }
async function board(): Promise<any[]> {
  if (boardCache.data.length && Date.now() - boardCache.at < 30_000) return boardCache.data // fresh + good
  const fixtures = await txGet('/api/fixtures/snapshot')
  const list = ((Array.isArray(fixtures) ? fixtures : []) as any[]).slice(0, 80)
  const results: (any | null)[] = new Array(list.length).fill(null)
  let next = 0
  async function worker(): Promise<void> {
    while (next < list.length) {
      const idx = next++
      const f = list[idx]
      try {
        const odds = await txGet(`/api/odds/snapshot/${f.FixtureId}`)
        if (Array.isArray(odds) && (odds as any[]).some(hasFinitePrice)) results[idx] = { ...f, odds }
      } catch { /* skip this fixture on an upstream error */ }
    }
  }
  await Promise.all(Array.from({ length: 6 }, () => worker()))
  const data = (results.filter(Boolean) as any[])
    .sort((a, b) => Number(has1x2(b.odds)) - Number(has1x2(a.odds))) // 1X2 fixtures first
  if (data.length) { boardCache = { at: Date.now(), data }; return data } // got a live board — cache it
  if (boardCache.data.length && Date.now() - boardCache.at < 300_000) return boardCache.data // flicker — keep last good
  return data // genuinely nothing priced right now
}

/**
 * Run a real devnet escrow deposit→release so the demo can link the settlement on-chain. Self-pays
 * (seller defaults to the buyer wallet) so ONE funded wallet is enough; set SELLER_WALLET to pay a
 * distinct seller. Returns {ok:false,error} on any failure so the UI can fall back gracefully.
 */
async function settle(amountSol: number): Promise<unknown> {
  try {
    const buyer = buyerKeypair()
    // pay the kit's seller wallet if present (set by setup.js), else self-pay so one funded wallet suffices.
    const seller = new PublicKey(process.env.SELLER_WALLET || process.env.WALLET || buyer.publicKey.toBase58())
    const reference = Keypair.generate().publicKey
    const amount = Math.max(0.0001, Number.isFinite(amountSol) ? amountSol : 0.0005)
    const program = await makeProgram(buyer, RPC)
    const depositSig = await deposit(program, buyer, seller, reference, amount, 600)
    const releaseSig = await release(program, buyer, seller, reference)
    const pda = escrowPda(buyer.publicKey, reference).toBase58()
    return {
      ok: true, amountSol: amount, reference: reference.toBase58(),
      deposit: { sig: depositSig, explorer: expl('tx', depositSig) },
      release: { sig: releaseSig, explorer: expl('tx', releaseSig) },
      escrow: { pda, explorer: expl('address', pda) },
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

http
  .createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'application/json')
    try {
      const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
      if (url.pathname === '/api/board') {
        // only fixtures with verified live 1X2 odds (odds inlined) — what the dashboard renders
        res.end(JSON.stringify(await board()))
      } else if (url.pathname === '/api/fixtures') {
        res.end(JSON.stringify(await txGet('/api/fixtures/snapshot')))
      } else if (url.pathname === '/api/odds') {
        res.end(JSON.stringify(await txGet(`/api/odds/snapshot/${url.searchParams.get('fixtureId') ?? ''}`)))
      } else if (url.pathname === '/api/edge') {
        // verified data (TxLINE) → LLM call: the on-thesis product, shared with the agent via analyzeEdge.
        const fixtureId = url.searchParams.get('fixtureId') ?? ''
        const [odds, fixtures] = await Promise.all([
          txGet(`/api/odds/snapshot/${fixtureId}`),
          txGet('/api/fixtures/snapshot'),
        ])
        res.end(JSON.stringify(await analyzeEdge({ fixtureId, odds, fixtures })))
      } else if (url.pathname === '/api/settle') {
        // real devnet escrow deposit→release so the demo links the settlement on-chain.
        res.end(JSON.stringify(await settle(Number(url.searchParams.get('amount') ?? '0.0005'))))
      } else {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'not found' }))
      }
    } catch (e) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: (e as Error).message, detail: (e as any)?.response?.data }))
    }
  })
  .listen(PORT, () => console.error(`[proxy] http://localhost:${PORT}  (GET /api/board · /api/fixtures · /api/odds?fixtureId= · /api/edge?fixtureId= · /api/settle?amount=)`))
