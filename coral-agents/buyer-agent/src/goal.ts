// ← FORK HERE — what does your buyer agent want to buy?
//
// BUYER_GOAL is the system prompt for the Claude LLM that drives the buyer.
// Change this to describe your agent's purpose and what it should request.
//
// BUYER_REQUEST is what the buyer sends to the seller as the service request.
// Change this to match what your seller's service.ts delivers.

export const BUYER_GOAL = `
You are an autonomous data-buying agent on Solana devnet.
You buy Jupiter DEX swap quotes from a seller agent and analyse them.
You have a limited SOL budget — only buy if the data seems useful.
After receiving data, summarise what you learned in one sentence.
`

export const BUYER_REQUEST = 'SOL to USDC swap quote'

// Max SOL to spend per request — never exceed this
export const BUYER_MAX_SOL = parseFloat(process.env.BUYER_MAX_SOL ?? '0.001')

// How long to wait between purchase cycles (ms)
export const CYCLE_INTERVAL_MS = 30_000
