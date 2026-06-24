'use client'

import { useWallet } from '@solana/wallet-adapter-react'
import { AgentCard } from '@/components/AgentCard'
import { Header } from '@/components/Header'

const LISTINGS = [
  {
    id: 'weather-agent',
    role: 'worker',
    priceLamports: 500_000,
    label: 'Live Weather',
    description: 'Real-time conditions for any city — temperature, humidity, wind, and forecast. Powered by open-meteo.com.',
    category: 'Data',
  },
]

export default function MarketplacePage() {
  const { connected } = useWallet()

  return (
    <div className="min-h-screen">
      <Header />

      <main className="max-w-2xl mx-auto px-4 py-14">
        {/* Hero */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 badge-green mb-4 px-3 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-solana-green animate-pulse" />
            <span className="text-xs">Solana Devnet</span>
          </div>
          <h1 className="text-3xl font-bold mb-2 tracking-tight">Agent Marketplace</h1>
          <p className="text-gray-400 text-sm max-w-sm mx-auto">
            Pay with SOL. Agent delivers real data. No account, no API key.
          </p>
          {!connected && (
            <p className="text-brand mt-3 text-xs font-medium">
              Connect Phantom wallet (top right) to buy
            </p>
          )}
        </div>

        {/* Listings */}
        <div className="space-y-3" data-testid="agent-listings">
          {LISTINGS.map(agent => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>

        {/* How it works */}
        <div className="mt-12 card border-brand/20">
          <p className="text-xs font-semibold text-brand mb-3 uppercase tracking-wide">How it works</p>
          <ol className="space-y-3 text-sm text-gray-400">
            <li className="flex gap-3">
              <span className="text-white font-semibold shrink-0">1.</span>
              <span>Connect your Phantom wallet — no signup required.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-white font-semibold shrink-0">2.</span>
              <span>Type your city and click Pay. Phantom signs a 0.0005 SOL transfer on devnet.</span>
            </li>
            <li className="flex gap-3">
              <span className="text-white font-semibold shrink-0">3.</span>
              <span>A Node.js agent detects the payment and delivers live weather data — temperature, humidity, wind, and condition.</span>
            </li>
          </ol>
        </div>
      </main>
    </div>
  )
}
