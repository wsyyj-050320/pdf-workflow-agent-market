#!/usr/bin/env node
// Generates devnet wallets and writes .env — run once after git clone
//
// Usage: node scripts/setup.js

import { Keypair } from '@solana/web3.js'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import bs58 from 'bs58'

const __dir = dirname(fileURLToPath(import.meta.url))
const root = join(__dir, '..')
const envPath = join(root, '.env')
const examplePath = join(root, '.env.example')

if (existsSync(envPath)) {
  const existing = readFileSync(envPath, 'utf8')
  if (existing.match(/^WALLET=\S+/m) && existing.match(/^BUYER_KEYPAIR_B58=\S+/m)) {
    console.log('.env already has wallets — delete it and re-run if you want fresh keys.')
    process.exit(0)
  }
}

const seller = Keypair.generate()
const buyer  = Keypair.generate()

const sellerPubkey = seller.publicKey.toBase58()
const buyerPubkey  = buyer.publicKey.toBase58()
const buyerB58     = bs58.encode(buyer.secretKey)

// Read .env.example and fill in the generated values
let env = readFileSync(examplePath, 'utf8')
env = env
  .replace(/^WALLET=.*$/m,            `WALLET=${sellerPubkey}`)
  .replace(/^BUYER_KEYPAIR_B58=.*$/m, `BUYER_KEYPAIR_B58=${buyerB58}`)
  .replace(/^SOLANA_RPC_URL=.*$/m,    'SOLANA_RPC_URL=https://api.devnet.solana.com')

writeFileSync(envPath, env)

console.log(`
Setup complete — wallets generated and saved to .env

  Seller wallet  ${sellerPubkey}
  Buyer  wallet  ${buyerPubkey}

Fund both wallets with devnet SOL before running any track:

  https://faucet.solana.com

  Paste each address above, request 1 SOL each.
  Tracks 1 & 2 need ~0.01 SOL total to run several cycles.
  Track 3 uses your Phantom wallet — fund that separately.

Once funded, pick a track and run:

  cd examples/track-1-pay-per-call && docker compose up
  # open http://localhost:3000/track-1

  cd examples/track-2-agent-trading && docker compose up
  # open http://localhost:3000/track-2

  cd examples/track-3-consumer-checkout && docker compose up
  # open http://localhost:3000/track-3 (connect Phantom on Devnet)
`)
