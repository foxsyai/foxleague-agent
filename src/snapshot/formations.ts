// What formation wins against which: one match per row (from FoxLeague's public match statistics), summed into the
// agent's own formation record and the pooled record of every team the install runs.

/** One revealed match from a team's side: its formation, the rival's, the score and how much stronger it was. */
export interface FormationMatch {
  key: string
  at: string
  mine: string
  theirs: string
  gf: number
  ga: number
  /** How much stronger this team's eleven was than the rival's as both played, in percent (negative: weaker); null when unknown. */
  edge: number | null
  rivalUserId: number | null
}

/** A strength gap within this many percent either way counts as an even match: the fair test of a formation. */
export const EVEN_BAND = 10

/** Won, drawn, lost. */
export type WDL = [number, number, number]

export interface FormationRecordRow {
  mine: string
  theirs: string
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  /** The mean strength edge in percent, rounded; null when never known. */
  edge: number | null
  /** The results by strength band: this team more than EVEN_BAND percent stronger, within it, more than it weaker (unknown strength: in none). */
  bands: { stronger: WDL; even: WDL; weaker: WDL }
}

export interface FormationRecord {
  matches: number
  /** Revealed matches whose formations are not read yet (FoxLeague hid them, a read failed or this tick's reads ran out): not counted. */
  unread: number
  rows: FormationRecordRow[]
  /** The rivals' formations in those matches, most common first: the field ranked draws from. */
  field: { formation: string; matches: number }[]
  /** The matches counted, kept for the pooled record (not shown to the plan). */
  games?: FormationMatch[]
}

/** Results by formation pair, most played first. */
export function summariseFormations(games: FormationMatch[], unread = 0): FormationRecord {
  const rows = new Map<string, FormationRecordRow & { edgeSum: number; edgeN: number }>()
  const field = new Map<string, number>()
  for (const g of games) {
    const k = `${g.mine} ${g.theirs}`
    const r = rows.get(k) ?? { mine: g.mine, theirs: g.theirs, played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0, edge: null, bands: { stronger: [0, 0, 0], even: [0, 0, 0], weaker: [0, 0, 0] }, edgeSum: 0, edgeN: 0 }
    const result = g.gf > g.ga ? 0 : g.gf === g.ga ? 1 : 2
    r.played++
    if (result === 0) r.won++
    else if (result === 1) r.drawn++
    else r.lost++
    r.goalsFor += g.gf
    r.goalsAgainst += g.ga
    if (typeof g.edge === 'number' && Number.isFinite(g.edge)) {
      r.edgeSum += g.edge
      r.edgeN++
      r.bands[g.edge > EVEN_BAND ? 'stronger' : g.edge < -EVEN_BAND ? 'weaker' : 'even'][result]++
    }
    rows.set(k, r)
    field.set(g.theirs, (field.get(g.theirs) ?? 0) + 1)
  }
  return {
    matches: games.length,
    unread,
    rows: [...rows.values()].sort((a, b) => b.played - a.played).map(({ edgeSum, edgeN, ...r }) => ({ ...r, edge: edgeN ? Math.round(edgeSum / edgeN) : null })),
    field: [...field].sort((a, b) => b[1] - a[1]).map(([formation, matches]) => ({ formation, matches })),
  }
}
