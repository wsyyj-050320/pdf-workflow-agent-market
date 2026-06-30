// World Cup Oracle — a captivating React 18 app (no build) over LIVE TxODDS devnet data.
// Talks to the local proxy (../server/proxy.ts: GET /api/board — only fixtures with verified live 1X2
// odds, inlined). If the proxy/token isn't up it shows a clearly-labelled demo board; it never mixes
// demo numbers into a live fixture.

import React, { useState, useEffect, useMemo } from 'https://esm.sh/react@18.3.1'
import { createRoot } from 'https://esm.sh/react-dom@18.3.1/client'
import htm from 'https://esm.sh/htm@3.1.1'

const html = htm.bind(React.createElement)
const PROXY = window.TXODDS_PROXY ?? 'http://localhost:8801'

// ── flags + abbreviations (national teams) ──────────────────────────────────
const FLAGS = {
  brazil: 'br', argentina: 'ar', france: 'fr', england: 'gb-eng', spain: 'es', germany: 'de',
  portugal: 'pt', netherlands: 'nl', italy: 'it', belgium: 'be', croatia: 'hr', uruguay: 'uy',
  'united states': 'us', usa: 'us', mexico: 'mx', japan: 'jp', 'south korea': 'kr', 'korea republic': 'kr',
  senegal: 'sn', morocco: 'ma', switzerland: 'ch', denmark: 'dk', poland: 'pl', serbia: 'rs',
  ecuador: 'ec', ghana: 'gh', cameroon: 'cm', 'saudi arabia': 'sa', australia: 'au', canada: 'ca',
  qatar: 'qa', tunisia: 'tn', wales: 'gb-wls', scotland: 'gb-sct', 'northern ireland': 'gb-nir',
  ireland: 'ie', norway: 'no', sweden: 'se', austria: 'at', 'czech republic': 'cz', czechia: 'cz',
  turkey: 'tr', 'türkiye': 'tr', ukraine: 'ua', colombia: 'co', chile: 'cl', peru: 'pe', paraguay: 'py',
  nigeria: 'ng', egypt: 'eg', algeria: 'dz', 'ivory coast': 'ci', greece: 'gr', hungary: 'hu',
  romania: 'ro', iran: 'ir', china: 'cn', 'costa rica': 'cr', panama: 'pa', jamaica: 'jm',
  'new zealand': 'nz', 'south africa': 'za', slovenia: 'si', slovakia: 'sk', finland: 'fi',
  venezuela: 've', bolivia: 'bo',
}
const ABBR = {
  brazil: 'BRA', argentina: 'ARG', france: 'FRA', england: 'ENG', spain: 'ESP', germany: 'GER',
  portugal: 'POR', netherlands: 'NED', uruguay: 'URU', 'united states': 'USA', mexico: 'MEX',
  serbia: 'SRB', denmark: 'DEN', ecuador: 'ECU', croatia: 'CRO', belgium: 'BEL',
}
const key = (n) => (n || '').trim().toLowerCase()
const flagCode = (n) => FLAGS[key(n)]
const abbr = (n) => ABBR[key(n)] ?? (n || '??').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase()

function Flag({ name, size }) {
  const [bad, setBad] = useState(false)
  const code = flagCode(name)
  const big = size === 'big'
  if (bad || !code) return html`<div class=${big ? 'flag-fallback' : 'mc-flag-fb'}>${abbr(name)}</div>`
  return html`<img class=${big ? 'flag' : 'mc-flag'} alt=${name}
    src=${`https://flagcdn.com/${big ? 'w160' : 'w80'}/${code}.png`} onError=${() => setBad(true)} />`
}

// ── demo fallback data (realistic de-margined 1X2) ──────────────────────────
const soon = (h) => new Date(Date.now() + h * 3600_000).toISOString()
const mkt = (pct) => [{ Bookmaker: 'StablePrice', SuperOddsType: '1X2 (de-margined)', PriceNames: ['part1', 'draw', 'part2'], Pct: pct }]
const DEMO_FIXTURES = [
  { FixtureId: 9001, Competition: 'World Cup', Participant1: 'Brazil', Participant2: 'Serbia', StartTime: soon(3) },
  { FixtureId: 9002, Competition: 'World Cup', Participant1: 'Argentina', Participant2: 'Mexico', StartTime: soon(6) },
  { FixtureId: 9003, Competition: 'World Cup', Participant1: 'France', Participant2: 'Denmark', StartTime: soon(27) },
  { FixtureId: 9004, Competition: 'World Cup', Participant1: 'England', Participant2: 'United States', StartTime: soon(30) },
  { FixtureId: 9005, Competition: 'World Cup', Participant1: 'Spain', Participant2: 'Germany', StartTime: soon(51) },
  { FixtureId: 9006, Competition: 'World Cup', Participant1: 'Portugal', Participant2: 'Uruguay', StartTime: soon(54) },
  { FixtureId: 9007, Competition: 'World Cup', Participant1: 'Netherlands', Participant2: 'Ecuador', StartTime: soon(75) },
  { FixtureId: 9008, Competition: 'World Cup', Participant1: 'Croatia', Participant2: 'Belgium', StartTime: soon(78) },
]
const DEMO_ODDS = {
  9001: mkt([62.4, 22.1, 15.5]), 9002: mkt([58.0, 24.5, 17.5]), 9003: mkt([54.2, 26.0, 19.8]),
  9004: mkt([47.5, 27.0, 25.5]), 9005: mkt([41.0, 27.5, 31.5]), 9006: mkt([49.0, 27.0, 24.0]),
  9007: mkt([56.5, 24.0, 19.5]), 9008: mkt([38.0, 28.0, 34.0]),
}
const demoOddsFor = (id) => DEMO_ODDS[id] ?? mkt([45, 27, 28])

// client-side deterministic edge (used when the proxy/LLM is offline) — mirrors agent/edge.ts
function detCall(m, teams) {
  const names = m.PriceNames, pcts = m.Pct
  let bi = -1, bp = -1
  names.forEach((_, i) => { const p = Number(pcts[i]); if (Number.isFinite(p) && p > bp) { bp = p; bi = i } })
  if (bi < 0) return { call: 'odds unavailable' }
  const label = names[bi] === 'part1' ? teams.home : names[bi] === 'part2' ? teams.away : 'Draw'
  return { call: `Odds favour ${label} (${bp.toFixed(0)}%)`, confidence: Number((bp / 100).toFixed(2)), note: 'deterministic (demo)' }
}
const clientEdge = (fx) => {
  // prefer the fixture's real inlined 1X2 odds (live board); only fall back to the demo board offline
  const live = Array.isArray(fx.odds) ? fx.odds.find((x) => String(x.SuperOddsType ?? '').includes('1X2')) : null
  const m = live?.PriceNames ? live : demoOddsFor(fx.FixtureId)[0]
  const teams = { home: fx.Participant1, away: fx.Participant2 }
  return { fixtureId: String(fx.FixtureId), teams, market: { names: m.PriceNames, pct: m.Pct }, analysis: detCall(m, teams), demo: !live }
}
const ESCROW_PROGRAM = 'R5NWNg9eRLWWQU81Xbzz5Du1k7jTDeeT92Ty6qCeXet'
const SETTLE_SOL = 0.0005

// ── odds board ──────────────────────────────────────────────────────────────
// LIVE TxODDS markets are messy: Pct values arrive as strings ("41.946"), some priced "NA",
// and many fixtures carry only over/under or Asian-handicap rows with no 1X2. Pick the best
// renderable market — a 1X2 result with usable numbers first, else any market that has at
// least one finite percentage — and treat every percentage as possibly-missing throughout.
const hasUsablePct = (m) =>
  Array.isArray(m?.PriceNames) && m.PriceNames.some((_, i) => Number.isFinite(Number((m.Pct || [])[i])))
function pickMarket(odds) {
  if (!Array.isArray(odds)) return odds
  return odds.find((x) => String(x?.SuperOddsType ?? '').includes('1X2') && hasUsablePct(x))
    ?? odds.find(hasUsablePct)
    ?? null
}

function Board({ fixture, odds, loading }) {
  if (loading) return html`<div class="board"><p class="muted">fetching de-margined odds…</p></div>`
  const m = pickMarket(odds)
  const names = Array.isArray(m?.PriceNames) ? m.PriceNames : null
  if (!names) return html`<div class="board"><p class="muted">No priced market for this fixture yet.</p></div>`
  const pct = names.map((_, i) => Number((m.Pct || [])[i]))
  const labelOf = { part1: fixture.Participant1, draw: 'Draw', part2: fixture.Participant2, over: 'Over', under: 'Under' }
  const cls = { part1: 'home', draw: 'draw', part2: 'away', over: 'home', under: 'away' }
  // favourite = the highest *finite* percentage (indexOf(Math.max) breaks when any price is NaN)
  let favI = -1, favVal = -Infinity
  pct.forEach((p, i) => { if (Number.isFinite(p) && p > favVal) { favVal = p; favI = i } })
  if (favI < 0) return html`<div class="board"><p class="muted">No priced market for this fixture yet.</p></div>`
  const favLabel = labelOf[names[favI]] ?? names[favI]
  const fmt = (p) => (Number.isFinite(p) ? p.toFixed(0) : '—')
  return html`
    <div class="board">
      <div class="board-head"><span>${m.Bookmaker} · ${m.SuperOddsType}</span><span>implied probability</span></div>
      ${names.map((name, i) => html`
        <div class=${'outcome' + (i === favI ? ' fav' : '')} key=${name}>
          <span class="label">${labelOf[name] ?? name}</span>
          <span class="track"><span class=${'fill ' + (cls[name] ?? 'draw')} style=${{ width: `${Number.isFinite(pct[i]) ? Math.min(100, pct[i]) : 0}%` }}></span></span>
          <span class="val">${fmt(pct[i])}%</span>
        </div>`)}
      <div class="edge">
        <span class="e-ico">⚡</span>
        <span class="e-text"><b>${favLabel}</b> is the value pick at <b>${fmt(pct[favI])}%</b>
          <div class="e-sub">de-margined implied probability — the verified input the agent turns into a one-line call</div>
        </span>
        <span class="e-cta">txline edge ${fixture.FixtureId}</span>
      </div>
    </div>`
}

function MatchCard({ fx, on, onSelect }) {
  return html`
    <div class=${'mcard' + (on ? ' on' : '')} onClick=${() => onSelect(fx)}>
      <div class="mc-top">
        <span class="mc-side"><${Flag} name=${fx.Participant1} /><span class="mc-abbr">${abbr(fx.Participant1)}</span></span>
        <span class="mc-vs">vs</span>
        <span class="mc-side r"><${Flag} name=${fx.Participant2} /><span class="mc-abbr">${abbr(fx.Participant2)}</span></span>
      </div>
      <div class="mc-comp"><span class="c">${fx.Competition}</span><span>${new Date(fx.StartTime).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span></div>
    </div>`
}

// the agent's LLM value call (verified odds → one-line call) — the middle pillar
function EdgeCard({ edge }) {
  if (!edge) return html`<div class="edgecard"><p class="muted">analysing the edge…</p></div>`
  const a = edge.analysis || {}
  const conf = typeof a.confidence === 'number' ? Math.round(a.confidence * 100) : null
  const det = /deterministic/i.test(a.note || '')
  return html`
    <div class="edgecard">
      <div class="ec-head"><span class="ec-tag">🤖 agent's call</span>
        <span class=${'ec-badge' + (det ? '' : ' llm')}>${det ? 'deterministic' : 'LLM'}</span></div>
      <p class="ec-call">${a.call}</p>
      ${conf != null && html`
        <div class="ec-conf"><span>confidence</span>
          <div class="ec-bar"><div class="ec-fill" style=${{ width: `${conf}%` }}></div></div><b>${conf}%</b></div>`}
    </div>`
}

// the settlement pillar — a real devnet escrow deposit→release, linked on Explorer
function SettleResult({ r }) {
  if (r.ok) return html`
    <div class="settled ok">💸 settled <b>${r.amountSol} SOL</b> on devnet —
      <a href=${r.deposit.explorer} target="_blank" rel="noreferrer">deposit ↗</a> ·
      <a href=${r.release.explorer} target="_blank" rel="noreferrer">release ↗</a> ·
      <a href=${r.escrow.explorer} target="_blank" rel="noreferrer">escrow PDA ↗</a></div>`
  return html`
    <div class="settled sim">⚠ live settle unavailable${r.error ? ` (${String(r.error).slice(0, 70)})` : ''} —
      needs a funded devnet buyer wallet (.env). See the
      <a href=${`https://explorer.solana.com/address/${ESCROW_PROGRAM}?cluster=devnet`} target="_blank" rel="noreferrer">escrow program ↗</a></div>`
}

// ── "Eight Layers" tab — the architecture, mapped to THIS demo ───────────────
const LAYERS = [
  { n: 1, icon: '🖥️', title: 'Frontend', tag: 'this page',
    what: 'A React dashboard rendering the live board — verified odds, the agent’s reasoning, settlement links. Forkable, no build step.',
    here: 'This board — examples/txodds/web, a no-build React app talking only to the local proxy.' },
  { n: 2, icon: '🧩', title: 'The service', tag: 'new code',
    what: 'deliverService() is the body of a paid endpoint. Return a string; it’s sold automatically. The main fork.',
    here: 'The txline edge — analyzeEdge() turns verified odds into the call you see on the board.' },
  { n: 3, icon: '🎭', title: 'The seller persona', tag: 'config',
    what: 'Cost floor, inventory, LLM strategy — a specialist that sells one thing well, or a generalist. All config.',
    here: 'This oracle is one specialist: the World Cup edge. FLOOR_SOL sets the price; agent/service.ts the goods.' },
  { n: 4, icon: '🛒', title: 'The buyer', tag: 'env',
    what: 'Decides what to buy and funds it inside a code-enforced budget, then settles the order on-chain.',
    here: 'The buyer wallet funds the escrow and releases on delivery; the runtime’s market/ adds best-value selection.' },
  { n: 5, icon: '🔒', title: 'Solana Pay + escrow', tag: 'unchanged',
    what: 'A unique reference binds the deal; pays on release, refunds after a deadline. Set the price, tier it, swap SOL for USDC.',
    here: 'The agent delivers its call and the buyer escrow settles on its own — a real devnet deposit→release, linked on Explorer.' },
  { n: 6, icon: '🕸️', title: 'New agents', tag: 'optional',
    what: 'Drop one in and a pair becomes a graph: an arbiter, a reseller, an oracle paid to verify another’s work.',
    here: 'Not shipped here — the runtime’s coral/ + market/ modules are the rails to grow this one agent into a market.' },
  { n: 7, icon: '⚙️', title: 'The runtime', tag: 'unchanged',
    what: 'CoralOS client, Solana Pay, provider-modular LLM shim + the market protocol. Import them, write behavior.',
    here: 'packages/agent-runtime — imported unchanged; this demo only writes behavior on top.' },
  { n: 8, icon: '⛓️', title: 'The contract', tag: 'unchanged',
    what: 'The escrow program (the only Rust). The settlement spine, not an afterthought.',
    here: 'Devnet-deployed; the Settle button calls initialize→release. Add an arbitrate instruction to extend.' },
]
const tagSlug = (t) => 't-' + t.replace(/\s+/g, '-')

function LayersTab() {
  return html`
    <main>
      <h3 class="grid-title">Eight layers, all yours to change</h3>
      <p class="layers-intro">The rails are done — coordination, LLM bidding, trustless settlement. Everything you change sits on
        top. For this World Cup oracle, <b>only #2 (the service) is real new code</b> — the rest is config, env, or untouched rails.</p>
      <div class="layers">
        ${LAYERS.map((l) => html`
          <div class="layer" key=${l.n}>
            <div class="layer-top">
              <span class="layer-ico">${l.icon}</span>
              <span class="layer-n">${String(l.n).padStart(2, '0')}</span>
              <span class=${'layer-tag ' + tagSlug(l.tag)}>${l.tag}</span>
            </div>
            <h4 class="layer-title">${l.title}</h4>
            <p class="layer-what">${l.what}</p>
            <p class="layer-here"><span>in this demo</span> ${l.here}</p>
          </div>`)}
      </div>
    </main>`
}

function App() {
  const [fixtures, setFixtures] = useState(null)
  const [source, setSource] = useState(null) // 'live' | 'demo'
  const [idx, setIdx] = useState(0)
  const [odds, setOdds] = useState(null)
  const [loadingOdds, setLoadingOdds] = useState(false)
  const [edge, setEdge] = useState(null)
  const [settleRes, setSettleRes] = useState(null)
  const [settling, setSettling] = useState(false)
  const [tab, setTab] = useState('oracle')
  const selected = fixtures ? fixtures[idx] : null

  // load the board: fixtures with verified live odds (inlined). The free World Cup tier's odds are
  // intermittent and the proxy needs a few seconds to subscribe on a cold start, so we KEEP polling
  // until live data arrives — showing the labelled sample board meanwhile, then switching to live on
  // its own. We never mix demo numbers into a live fixture.
  useEffect(() => {
    let alive = true
    let timer = null
    let tries = 0
    const load = () => {
      fetch(`${PROXY}/api/board`).then((r) => r.json()).then((d) => {
        if (!alive) return
        if (Array.isArray(d) && d.length) { setFixtures(d); setSource('live'); setIdx(0); return }
        throw new Error('no live fixtures yet')
      }).catch(() => {
        if (!alive) return
        setFixtures((f) => f ?? DEMO_FIXTURES)   // keep the board full while we wait
        setSource((s) => (s === 'live' ? s : 'demo'))
        if (tries++ < 30) timer = setTimeout(load, 5000) // live odds can return at any time
      })
    }
    load()
    return () => { alive = false; if (timer) clearTimeout(timer) }
  }, [])

  // odds come inlined on live fixtures (from /api/board); demo fixtures use the baked-in board.
  useEffect(() => {
    if (!selected) return
    setLoadingOdds(false)
    setOdds(Array.isArray(selected.odds) ? selected.odds : demoOddsFor(selected.FixtureId))
  }, [idx, fixtures])

  // the agent delivers its call, then the buyer escrow fires automatically (Option A — no button).
  // Live → the proxy's /api/edge (real odds → real call) → /api/settle (real devnet deposit→release);
  // demo → a client-side call only (no wallet flow). Never invents data for an empty game.
  useEffect(() => {
    if (!selected) return
    let alive = true
    setEdge(null); setSettleRes(null); setSettling(false)
    ;(async () => {
      // 1) the agent's call
      let e = clientEdge(selected)
      if (source === 'live') {
        try {
          const d = await (await fetch(`${PROXY}/api/edge?fixtureId=${selected.FixtureId}`)).json()
          if (d && d.analysis) e = d
        } catch { /* keep the client-side call */ }
      }
      if (!alive) return
      setEdge(e)
      // 2) delivery → settlement fires on its own; the Explorer links appear when it confirms
      if (source !== 'live') return
      setSettling(true)
      try {
        const s = await (await fetch(`${PROXY}/api/settle?fixtureId=${selected.FixtureId}&amount=${SETTLE_SOL}`)).json()
        if (alive) setSettleRes(s)
      } catch (err) {
        if (alive) setSettleRes({ ok: false, error: String(err) })
      } finally {
        if (alive) setSettling(false)
      }
    })()
    return () => { alive = false }
  }, [idx, fixtures])

  const select = (fx) => setIdx(fixtures.findIndex((f) => f.FixtureId === fx.FixtureId))

  const comps = useMemo(() => fixtures ? new Set(fixtures.map((f) => f.Competition)).size : 0, [fixtures])

  return html`
    <header class="hero">
      <span class=${'kicker' + (source === 'demo' ? ' demo' : '')}>
        <span class="dot"></span>${source === 'demo' ? 'sample fixtures · live odds quiet' : 'live · devnet · free World Cup tier'}
      </span>
      <h1><span class="trophy">🏆</span> World Cup Oracle</h1>
      <p class="tagline">Verified TxODDS football data — fetched on Solana devnet, turned into a value call by an agent, and settled in SOL.</p>
      <div class="stats">
        <div class="stat"><b>${fixtures ? fixtures.length : '—'}</b><span>fixtures</span></div>
        <div class="stat"><b>${comps || '—'}</b><span>competitions</span></div>
        <div class="stat"><b>1X2</b><span>de-margined</span></div>
        <div class="stat"><b>SOL</b><span>settled</span></div>
      </div>
      <nav class="tabs">
        <button class=${'tab' + (tab === 'oracle' ? ' on' : '')} onClick=${() => setTab('oracle')}>🏆 Oracle</button>
        <button class=${'tab' + (tab === 'layers' ? ' on' : '')} onClick=${() => setTab('layers')}>🧱 Eight Layers</button>
      </nav>
    </header>
    ${tab === 'layers' ? html`<${LayersTab} />` : html`
    <main>
      ${!fixtures && html`<p class="muted" style=${{ textAlign: 'center' }}>loading fixtures…</p>`}
      ${selected && html`
        <section class="featured">
          <div class="feat-top">
            <span class="chip">${selected.Competition}</span>
            <span class="feat-when">kickoff ${new Date(selected.StartTime).toLocaleString([], { weekday: 'long', hour: '2-digit', minute: '2-digit' })}</span>
          </div>
          <div class="matchup">
            <div class="team home"><${Flag} name=${selected.Participant1} size="big" /><span class="team-name">${selected.Participant1}</span></div>
            <div class="vs">VS</div>
            <div class="team away"><${Flag} name=${selected.Participant2} size="big" /><span class="team-name">${selected.Participant2}</span></div>
          </div>
          <${Board} fixture=${selected} odds=${odds} loading=${loadingOdds} />
          <div class="thesis">
            <${EdgeCard} edge=${edge} />
            <div class="settle-row">
              ${settling && html`<div class="settling-auto">
                <span class="spin"></span> agent delivered — buyer escrow settling ${SETTLE_SOL} SOL on devnet…
              </div>`}
              ${settleRes && html`<${SettleResult} r=${settleRes} />`}
            </div>
          </div>
        </section>`}

      <h3 class="grid-title">All fixtures — tap a match</h3>
      <div class="grid">
        ${fixtures?.map((fx) => html`<${MatchCard} key=${fx.FixtureId} fx=${fx} on=${selected?.FixtureId === fx.FixtureId} onSelect=${select} />`)}
      </div>
    </main>
    <footer class="foot">
      <p class="pillars">Verified <b>TxODDS</b> data · the agent's <b>LLM call</b> · settled by <b>Solana escrow</b>.</p>
      <p>${source === 'live'
        ? `live · devnet · ${fixtures.length} fixture${fixtures.length === 1 ? '' : 's'} with verified odds`
        : source === 'demo'
          ? 'live World Cup odds are quiet right now — showing sample fixtures; the board switches to live automatically when they return'
          : 'connecting to the live proxy…'}</p>
    </footer>`}`
}

createRoot(document.getElementById('root')).render(html`<${App} />`)
