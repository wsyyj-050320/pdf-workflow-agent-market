'use client'

import { useState, useEffect, useRef } from 'react'
import { Header } from '@/components/Header'

interface AgentLog {
  time: string
  action: string
  detail: string
  txSig?: string
}

const API = process.env.NEXT_PUBLIC_API_SERVER ?? 'http://localhost:8081'
const EXPLORER = 'https://explorer.solana.com/tx'

function fmt(d: Date) { return d.toTimeString().slice(0, 8) }

function TxLink({ sig }: { sig: string }) {
  return (
    <a href={`${EXPLORER}/${sig}?cluster=devnet`} target="_blank" rel="noopener noreferrer"
      className="text-solana-green underline text-xs ml-1">{sig.slice(0, 8)}…↗</a>
  )
}

export default function Track2Page() {
  const [sellerLog, setSellerLog] = useState<AgentLog[]>([])
  const [buyerLog, setBuyerLog] = useState<AgentLog[]>([])
  const [totalPaid, setTotalPaid] = useState(0)
  const [trades, setTrades] = useState(0)
  const sellerRef = useRef<HTMLDivElement>(null)
  const buyerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`${API}/api/v1/agents`)
        if (!res.ok) return
        const data: { id: string; actions: { action: string; detail: string; timestamp?: string }[] }[] = await res.json()

        const seller = data.find(d => d.id === 'seller-agent')
        const buyer = data.find(d => d.id === 'buyer-agent')

        if (seller) {
          setSellerLog(seller.actions?.slice(-20).map(a => {
            const sig = a.detail?.match(/sig[=:]\s*(\w{40,})/i)?.[1]
            if (a.action === 'payment-received') setTrades(n => n + 1)
            return { time: fmt(new Date(a.timestamp ?? Date.now())), action: a.action, detail: a.detail?.slice(0, 70) ?? '', txSig: sig }
          }) ?? [])
        }

        if (buyer) {
          setBuyerLog(buyer.actions?.slice(-20).map(a => {
            const sig = a.detail?.match(/sig[=:]\s*(\w{40,})/i)?.[1]
            if (a.action === 'paid') setTotalPaid(n => n + 0.0005)
            return { time: fmt(new Date(a.timestamp ?? Date.now())), action: a.action, detail: a.detail?.slice(0, 70) ?? '', txSig: sig }
          }) ?? [])
        }
      } catch { /* api not ready */ }
    }

    const id = setInterval(poll, 2_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => { sellerRef.current?.scrollTo({ top: sellerRef.current.scrollHeight, behavior: 'smooth' }) }, [sellerLog])
  useEffect(() => { buyerRef.current?.scrollTo({ top: buyerRef.current.scrollHeight, behavior: 'smooth' }) }, [buyerLog])

  const actionColour = (action: string) => {
    if (action.includes('payment') || action.includes('paid')) return 'text-solana-green'
    if (action.includes('deliver') || action.includes('DELIVERED')) return 'text-blue-400'
    if (action.includes('error')) return 'text-red-400'
    if (action.includes('url') || action.includes('request')) return 'text-yellow-400'
    return 'text-gray-400'
  }

  const Panel = ({ title, subtitle, logs, ref: r }: { title: string; subtitle: string; logs: AgentLog[]; ref: React.RefObject<HTMLDivElement | null> }) => (
    <div className="card flex-1">
      <p className="text-sm font-semibold text-white mb-0.5">{title}</p>
      <p className="text-xs text-gray-500 mb-3">{subtitle}</p>
      <div ref={r as React.RefObject<HTMLDivElement>} className="space-y-1 max-h-64 overflow-y-auto font-mono text-xs">
        {logs.length === 0 && <p className="text-gray-600 py-4 text-center">Waiting…</p>}
        {logs.map((l, i) => (
          <div key={i} className="flex gap-2 items-start">
            <span className="text-gray-600 shrink-0">{l.time}</span>
            <span className={`${actionColour(l.action)} shrink-0 w-28 truncate`}>{l.action}</span>
            <span className="text-gray-500 truncate">
              {l.detail}
              {l.txSig && <TxLink sig={l.txSig} />}
            </span>
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <div className="min-h-screen">
      <Header />
      <main className="max-w-4xl mx-auto px-4 py-10">

        <div className="mb-8">
          <div className="inline-flex items-center gap-2 badge-green mb-3 px-3 py-1">
            <span className="w-1.5 h-1.5 rounded-full bg-solana-green animate-pulse" />
            <span className="text-xs">Track 2 — Agent-to-Agent Trading</span>
          </div>
          <h1 className="text-2xl font-bold mb-1">Autonomous Trading Session</h1>
          <p className="text-gray-400 text-sm">Two agents trading autonomously. No human approves anything.</p>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          {[
            { label: 'Trades completed', value: trades },
            { label: 'Total SOL paid', value: `${totalPaid.toFixed(4)} SOL` },
            { label: 'Cycle interval', value: '30s' },
          ].map(s => (
            <div key={s.label} className="card text-center">
              <p className="text-lg font-bold text-white">{s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          ))}
        </div>

        {/* Two-panel terminal */}
        <div className="flex gap-4">
          <Panel title="📈 Seller Agent" subtitle="Sells CoinGecko price data" logs={sellerLog} ref={sellerRef} />
          <Panel title="🤖 Buyer Agent (Claude)" subtitle="Buys and analyses data" logs={buyerLog} ref={buyerRef} />
        </div>

        {/* On-chain settlement note */}
        <div className="mt-4 card border-brand/20">
          <p className="text-xs text-gray-400">
            Every payment settles on <span className="text-white">Solana devnet</span> in under 1 second.
            Click any transaction hash to verify on Solana Explorer.
          </p>
        </div>

      </main>
    </div>
  )
}
