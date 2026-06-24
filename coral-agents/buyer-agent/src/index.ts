/**
 * Buyer agent — autonomous CoralOS participant that purchases data from the seller agent.
 *
 * Purchase loop (one cycle):
 * 1. Send `request <query>` to seller via CoralOS thread.
 * 2. Wait for `PAYMENT_REQUIRED memo=<m> amount=<sol> url=<solana:...>` response.
 * 3. Pay the Solana Pay URL from the buyer wallet.
 * 4. Send `paid <sig> memo=<m>` to seller as proof.
 * 5. Wait for `DELIVERED <data>` response.
 * 6. Summarise the data with Claude Haiku and broadcast the analysis.
 *
 * Environment variables required:
 * - `BUYER_KEYPAIR_B58` — base58-encoded 64-byte Solana keypair (devnet funded)
 * - `CORAL_CONNECTION_URL` — CoralOS MCP server URL
 * - `ANTHROPIC_API_KEY` — optional; analysis step is skipped if absent
 */
import Anthropic from '@anthropic-ai/sdk'
import { startCoralAgent } from '@pay/agent-core-ts'
import { payFromUrl, getBuyerPublicKey } from './wallet.js'
import { BUYER_GOAL, BUYER_REQUEST, BUYER_MAX_SOL, CYCLE_INTERVAL_MS } from './goal.js'

const llm = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null

async function summarise(data: string): Promise<string> {
  if (!llm) return `received: ${data.slice(0, 100)}`
  const msg = await llm.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 128,
    system: BUYER_GOAL,
    messages: [{ role: 'user', content: `Summarise this data in one sentence: ${data}` }],
  })
  return (msg.content[0] as { text: string }).text
}

await startCoralAgent({ agentName: 'buyer-agent' }, async (ctx) => {
  console.error(`[buyer-agent] wallet: ${getBuyerPublicKey()}`)
  console.error(`[buyer-agent] budget: ${BUYER_MAX_SOL} SOL per request`)
  console.error('[buyer-agent] starting purchase loop')

  // Give seller a moment to start up, then create a shared thread
  await new Promise(r => setTimeout(r, 4_000))
  const threadId = await ctx.createThread('buyer-seller-session', ['seller-agent'])
  console.error(`[buyer-agent] thread created: ${threadId}`)

  while (true) {
    try {
      // ── 1. Request service from seller ──────────────────────────────────
      console.error(`[buyer-agent] requesting: ${BUYER_REQUEST}`)
      await ctx.send(`request ${BUYER_REQUEST}`, threadId, ['seller-agent'])

      // ── 2. Wait for payment URL ─────────────────────────────────────────
      const payMention = await ctx.waitForMention(15_000)
      if (!payMention) {
        console.error('[buyer-agent] no response from seller, retrying next cycle')
        await new Promise(r => setTimeout(r, CYCLE_INTERVAL_MS))
        continue
      }

      const payText = payMention.text
      if (!payText.includes('PAYMENT_REQUIRED')) {
        console.error(`[buyer-agent] unexpected response: ${payText.slice(0, 120)}`)
        await new Promise(r => setTimeout(r, CYCLE_INTERVAL_MS))
        continue
      }

      // Parse: PAYMENT_REQUIRED memo=<memo> amount=<sol> url=<solana:...>
      const memoMatch = payText.match(/memo=(\S+)/)
      const urlMatch = payText.match(/url=(solana:\S+)/)
      const memo = memoMatch?.[1]
      const solanaUrl = urlMatch?.[1]

      if (!memo || !solanaUrl) {
        console.error('[buyer-agent] could not parse payment details')
        await new Promise(r => setTimeout(r, CYCLE_INTERVAL_MS))
        continue
      }

      // ── 3. Pay ──────────────────────────────────────────────────────────
      console.error(`[buyer-agent] paying memo=${memo}`)
      let sig: string
      try {
        sig = await payFromUrl(solanaUrl, BUYER_MAX_SOL)
      } catch (e) {
        console.error(`[buyer-agent] payment failed: ${e}`)
        await new Promise(r => setTimeout(r, CYCLE_INTERVAL_MS))
        continue
      }

      // ── 4. Send payment proof to seller ─────────────────────────────────
      await ctx.send(`paid ${sig} memo=${memo}`, threadId, ['seller-agent'])

      // ── 5. Wait for data delivery ────────────────────────────────────────
      const deliveryMention = await ctx.waitForMention(30_000)
      if (!deliveryMention?.text.includes('DELIVERED')) {
        console.error('[buyer-agent] no delivery received')
        await new Promise(r => setTimeout(r, CYCLE_INTERVAL_MS))
        continue
      }

      const raw = deliveryMention.text.replace(/^DELIVERED\s*/i, '').trim()
      console.error(`[buyer-agent] received data (${raw.length} chars)`)

      // ── 6. Analyse with Claude ───────────────────────────────────────────
      const summary = await summarise(raw)
      console.error(`[buyer-agent] analysis: ${summary}`)

      // Broadcast summary to thread
      await ctx.send(`ANALYSIS ${summary}`, threadId)

    } catch (e) {
      console.error(`[buyer-agent] cycle error: ${e}`)
    }

    await new Promise(r => setTimeout(r, CYCLE_INTERVAL_MS))
  }
})
