import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { encodeURL } from '@solana/pay'
import BigNumber from 'bignumber.js'
import { randomUUID } from 'crypto'

/** Lazy connection factory so each call gets a fresh `Connection` (safe across async boundaries). */
const connection = () =>
  new Connection(process.env.SOLANA_RPC_URL ?? 'https://api.devnet.solana.com')

/** Return value from `generatePaymentUrl`. */
export interface PaymentUrl {
  /** Full `solana:` URL encoding the transfer request. */
  url: string
  /** Short random memo that ties this URL to an entry in the `pending` map. */
  memo: string
  /** Requested amount in SOL. */
  amountSol: number
}

/**
 * Generate a Solana Pay transfer URL for the given buyer `request` string.
 * The memo is a random 8-character prefix of a UUIDv4 — unique per payment request.
 *
 * Requires:
 * - `SELLER_WALLET` — base58 public key of the seller's wallet.
 * - `PRICE_SOL`     — price in SOL (default `"0.0001"`).
 */
export function generatePaymentUrl(request: string): PaymentUrl {
  const recipient = process.env.SELLER_WALLET
  if (!recipient) throw new Error('SELLER_WALLET not set')

  const amountSol = parseFloat(process.env.PRICE_SOL ?? '0.0001')
  const memo = `pay-${randomUUID().slice(0, 8)}`

  const url = encodeURL({
    recipient: new PublicKey(recipient),
    amount: new BigNumber(amountSol),
    memo,
    label: 'Agent Service',
    message: request.slice(0, 100),
  })

  return { url: url.toString(), memo, amountSol }
}

/**
 * Verify that `sig` is a confirmed on-chain transaction that transferred at
 * least `PRICE_SOL` to `SELLER_WALLET`.
 *
 * A 1 % tolerance is applied to the expected amount to account for rounding.
 *
 * @returns `true` if the payment is valid, `false` otherwise (including on RPC errors).
 */
export async function verifyPayment(sig: string, memo: string): Promise<boolean> {
  try {
    const conn = connection()
    const tx = await conn.getTransaction(sig, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    })

    if (!tx) return false

    const recipient = process.env.SELLER_WALLET!
    const recipientPubkey = new PublicKey(recipient)

    // `getAccountKeys()` is available on versioned transactions; the legacy
    // `accountKeys` array is used as a fallback via `as any` for older TX versions.
    const accountKeys = tx.transaction.message.getAccountKeys
      ? tx.transaction.message.getAccountKeys()
      : { staticAccountKeys: (tx.transaction.message as any).accountKeys }

    const keys = accountKeys.staticAccountKeys ?? (accountKeys as any)
    const recipientIndex = Array.from({ length: keys.length }, (_, i) =>
      keys[i]?.toBase58?.() ?? keys[i]?.toString?.(),
    ).indexOf(recipientPubkey.toBase58())

    if (recipientIndex === -1) return false

    const preLamports = tx.meta?.preBalances?.[recipientIndex] ?? 0
    const postLamports = tx.meta?.postBalances?.[recipientIndex] ?? 0
    const received = (postLamports - preLamports) / LAMPORTS_PER_SOL

    const expected = parseFloat(process.env.PRICE_SOL ?? '0.0001')
    return received >= expected * 0.99 // 1 % tolerance
  } catch {
    return false
  }
}
