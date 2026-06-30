/**
 * Edge analysis — the "verified data → LLM call" transform, factored out so both the agent
 * (`deliverTxOdds`) and the web proxy (`/api/edge`) share one implementation. Pure except for the LLM
 * call, which is injectable, so the deterministic fallback is unit-tested without the network.
 *
 * Input is the two TxLINE snapshots the rest of the demo already fetches — `odds` for a fixture and the
 * `fixtures` list (to resolve team names). Output is the on-screen product: a matchup, the de-margined
 * 1X2 board, and a one-line call + confidence. If the LLM is unavailable (no key/credits) it falls back
 * to a deterministic odds-based pick, so a demo always renders a clean edge.
 */
import { complete, parseJsonReply, type CompleteOpts } from '@pay/agent-runtime'

export interface EdgeInput {
  fixtureId: number | string
  /** `/api/odds/snapshot/{id}` — array of markets. */
  odds: unknown
  /** `/api/fixtures/snapshot` — array of fixtures (for team names). Optional. */
  fixtures?: unknown
}

export interface Edge {
  fixtureId: string
  teams?: { home: unknown; away: unknown; competition: unknown }
  market?: { names: unknown; pct: unknown }
  analysis: { call: string; confidence?: number; note?: string }
}

type Llm = (opts: CompleteOpts) => Promise<string>
type Rec = Record<string, unknown>

/** Resolve the best de-margined market (1X2 preferred, else any with a finite price) + the matchup. */
function shape(input: EdgeInput) {
  const fixtureId = String(input.fixtureId)
  const arr = Array.isArray(input.odds) ? (input.odds as Rec[]) : []
  const finite = (x: Rec) =>
    Array.isArray(x.PriceNames) && (x.PriceNames as unknown[]).some((_, i) => Number.isFinite(Number((x.Pct as unknown[])?.[i])))
  const m = arr.find((x) => String(x.SuperOddsType ?? '').includes('1X2') && finite(x)) ?? arr.find(finite)
  const market = m ? { names: m.PriceNames, pct: m.Pct } : undefined
  const fx = Array.isArray(input.fixtures)
    ? (input.fixtures as Rec[]).find((f) => String(f.FixtureId) === fixtureId)
    : undefined
  const teams = fx ? { home: fx.Participant1, away: fx.Participant2, competition: fx.Competition } : undefined
  return { fixtureId, market, teams }
}

/** Deterministic odds-based pick (favourite by implied %) — the no-LLM fallback. */
export function deterministicCall(
  market: { names: unknown; pct: unknown } | undefined,
  teams: { home: unknown; away: unknown } | undefined,
): Edge['analysis'] {
  const names = (market?.names ?? []) as string[]
  const pcts = (market?.pct ?? []) as string[]
  let bi = -1, bp = -1
  names.forEach((_, i) => { const p = Number(pcts[i]); if (Number.isFinite(p) && p > bp) { bp = p; bi = i } })
  if (bi < 0) return { call: 'odds unavailable' }
  const label = names[bi] === 'part1' ? (teams?.home ?? 'Home') : names[bi] === 'part2' ? (teams?.away ?? 'Away') : 'Draw'
  return {
    call: `Odds favour ${label} (${bp.toFixed(0)}%)`,
    confidence: Number((bp / 100).toFixed(2)),
    note: 'deterministic — add an LLM key for a model call',
  }
}

/** Turn the verified snapshots into the sellable edge. `llm` is injectable for tests. */
export async function analyzeEdge(input: EdgeInput, llm: Llm = complete): Promise<Edge> {
  const { fixtureId, market, teams } = shape(input)
  const matchup = teams ? `${teams.home} v ${teams.away}` : `fixture ${fixtureId}`

  let analysis: Edge['analysis'] | undefined
  try {
    const raw = await llm({
      system:
        'You are a disciplined football trading analyst. From de-margined World Cup odds, return JSON ' +
        '{call, confidence} — a one-line value call and a 0-1 confidence. Be concise; never invent data.',
      user: `For ${matchup}, odds: ${JSON.stringify(input.odds).slice(0, 1500)}`,
      maxTokens: 200,
    })
    const parsed = parseJsonReply<{ call?: unknown; confidence?: unknown }>(raw)
    if (parsed && typeof parsed.call === 'string') {
      const confidence = Number(parsed.confidence)
      analysis = { call: parsed.call, ...(Number.isFinite(confidence) ? { confidence } : {}) }
    }
  } catch {
    /* LLM unavailable → deterministic fallback below */
  }

  return { fixtureId, teams, market, analysis: analysis ?? deterministicCall(market, teams) }
}
