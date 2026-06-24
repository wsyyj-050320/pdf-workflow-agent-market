// ← FORK HERE — replace deliverService() with your own service
//
// This is the only function you need to change to build your hackathon entry.
// Input:  the buyer's request string
// Output: your service's response string (JSON, plain text, whatever)
//
// Default: Jupiter DEX swap quote (SOL → USDC) — no API key needed

export async function deliverService(request: string): Promise<string> {
  const service = process.env.SERVICE ?? 'jupiter'

  switch (service) {
    case 'jupiter':
      return jupiterSwapQuote(request)
    case 'coingecko':
      return coingeckoPrice(request)
    case 'news':
      return newsHeadlines(request)
    default:
      return jupiterSwapQuote(request)
  }
}

// Jupiter DEX — best swap route SOL → USDC
// Set JUPITER_API_KEY in .env for higher rate limits (free at jup.ag/developers)
async function jupiterSwapQuote(_request: string): Promise<string> {
  const SOL = 'So11111111111111111111111111111111111111112'
  const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (process.env.JUPITER_API_KEY) headers['x-api-key'] = process.env.JUPITER_API_KEY
  const res = await fetch(
    `https://api.jup.ag/swap/v1/quote?inputMint=${SOL}&outputMint=${USDC}&amount=1000000000&slippageBps=50`,
    { headers },
  )
  if (!res.ok) return JSON.stringify({ error: 'jupiter unavailable', status: res.status })
  const data = await res.json() as Record<string, unknown>
  return JSON.stringify({
    service: 'jupiter-swap-quote',
    pair: 'SOL→USDC',
    inAmount: '1 SOL',
    outAmount: `${(Number(data.outAmount) / 1_000_000).toFixed(4)} USDC`,
    priceImpact: data.priceImpactPct,
    timestamp: new Date().toISOString(),
  })
}

// CoinGecko — SOL price in USD (no API key)
async function coingeckoPrice(request: string): Promise<string> {
  const coin = request.toLowerCase().includes('eth') ? 'ethereum' : 'solana'
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${coin}&vs_currencies=usd`,
  )
  if (!res.ok) return JSON.stringify({ error: 'coingecko unavailable' })
  const data = await res.json()
  return JSON.stringify({ coin, usd: data[coin]?.usd, timestamp: new Date().toISOString() })
}

// NewsAPI — top crypto headlines (requires NEWS_API_KEY)
async function newsHeadlines(request: string): Promise<string> {
  const key = process.env.NEWS_API_KEY
  if (!key) return JSON.stringify({ error: 'NEWS_API_KEY not set' })
  const q = encodeURIComponent(request || 'solana crypto')
  const res = await fetch(
    `https://newsapi.org/v2/everything?q=${q}&pageSize=5&sortBy=publishedAt&apiKey=${key}`,
  )
  if (!res.ok) return JSON.stringify({ error: 'newsapi unavailable' })
  const data = await res.json()
  const headlines = (data.articles ?? []).map((a: any) => ({
    title: a.title,
    source: a.source?.name,
    url: a.url,
  }))
  return JSON.stringify({ headlines, timestamp: new Date().toISOString() })
}
