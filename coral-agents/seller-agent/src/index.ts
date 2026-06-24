/**
 * Seller agent — autonomous CoralOS participant that sells data services for SOL.
 *
 * Command protocol (messages received from buyers via CoralOS):
 * - `request <query>`          → generate a Solana Pay URL; reply `PAYMENT_REQUIRED ...`
 * - `paid <sig> memo=<memo>`   → verify payment on-chain; reply `DELIVERED <data>` or `ERROR ...`
 *
 * Environment variables required:
 * - `SELLER_WALLET`    — base58 public key to receive payments
 * - `PRICE_SOL`        — price per request in SOL (default `"0.0001"`)
 * - `CORAL_CONNECTION_URL` — CoralOS MCP server URL
 */
import { startCoralAgent } from '@pay/agent-core-ts'
import { generatePaymentUrl, verifyPayment } from './payment.js'
import { deliverService } from './service.js'

// Pending payments: memo → { request, paid: false }
const pending = new Map<string, { request: string }>()

await startCoralAgent({ agentName: 'seller-agent' }, async (ctx) => {
  console.error('[seller-agent] ready — waiting for buyers')

  while (true) {
    try {
    const mention = await ctx.waitForMention()
    if (!mention) continue

    const text = mention.text.trim()
    console.error(`[seller-agent] mention: ${text.slice(0, 120)}`)

    // ── Command routing ──────────────────────────────────────────────────────

    // "request <query>" — buyer wants a service, get a payment URL first
    if (text.toLowerCase().startsWith('request')) {
      const query = text.replace(/^request\s*/i, '').trim() || 'default'
      const { url, memo, amountSol } = generatePaymentUrl(query)
      pending.set(memo, { request: query })
      await ctx.reply(
        mention,
        `PAYMENT_REQUIRED memo=${memo} amount=${amountSol} url=${url}`,
      )
      continue
    }

    // "paid <sig> memo=<memo>" — buyer claims to have paid
    if (text.toLowerCase().startsWith('paid')) {
      const sigMatch = text.match(/paid\s+(\S+)/i)
      const memoMatch = text.match(/memo=(\S+)/i)
      const sig = sigMatch?.[1]
      const memo = memoMatch?.[1]

      if (!sig || !memo) {
        await ctx.reply(mention, 'ERROR: expected format: paid <sig> memo=<memo>')
        continue
      }

      const entry = pending.get(memo)
      if (!entry) {
        await ctx.reply(mention, `ERROR: unknown memo ${memo}`)
        continue
      }

      console.error(`[seller-agent] verifying payment sig=${sig}`)
      const verified = await verifyPayment(sig, memo)

      if (!verified) {
        await ctx.reply(mention, `ERROR: payment not confirmed for memo=${memo}`)
        continue
      }

      pending.delete(memo)
      console.error(`[seller-agent] payment verified — delivering service`)

      try {
        const result = await deliverService(entry.request)
        await ctx.reply(mention, `DELIVERED ${result}`)
      } catch (e) {
        console.error(`[seller-agent] delivery error: ${e}`)
        await ctx.reply(mention, `ERROR: service delivery failed — ${(e as Error).message}`)
      }
      continue
    }

    // Unknown command
    await ctx.reply(
      mention,
      'Commands: "request <query>" to get a payment URL, "paid <sig> memo=<memo>" after paying',
    )
    } catch (e) {
      console.error(`[seller-agent] loop error: ${e}`)
    }
  }
})
