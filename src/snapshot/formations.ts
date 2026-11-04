// What formation wins against which: one match per row (from FoxLeague's public match statistics), summed into the
// agent's own formation record, the pooled record of every team the install runs, the league formation table and the
// casual test bench.

import { FORMATION_SLOTS, FORMATIONS_COMING_SOON } from '../executor/actions.ts'
import type { PlayerView } from './snapshot.ts'

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
  /** This team's ELO minus the rival's at kickoff (league table only); null when either is unknown. */
  eloGap?: number | null
}

/** A strength gap within this many percent either way counts as an even match: the fair test of a formation. */
export const EVEN_BAND = 10
/** Rated more than this many ELO points below the rival at kickoff: the underdog, the side a formation must lift. */
export const ELO_BAND = 100

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
  /** The results as the ELO underdog (rated more than ELO_BAND below the rival); only where the ELO at kickoff is known. */
  underdog?: WDL
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
  /** The casual games read (against FoxLeague's AI), kept for the casual test bench, never counted here. */
  casual?: FormationMatch[]
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
    if (typeof g.eloGap === 'number' && Number.isFinite(g.eloGap)) {
      r.underdog ??= [0, 0, 0]
      if (g.eloGap < -ELO_BAND) r.underdog[result]++
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

// ---- the league formation table (owner, 2026-11-04) ----

/** The public matches of the top teams by ELO, read a few teams at a time: each plan reads this many team histories. */
export const LEAGUE_TEAMS = 100
export const LEAGUE_TEAMS_PER_TICK = 3
/** New match statistics read per plan for the league table (about 120 KB each), after the agent's own and its rivals'. */
export const LEAGUE_READS_PER_TICK = 6
/** The table counts this many days; the store keeps 30. */
export const LEAGUE_DAYS = 14
/** A pairing of fewer matches proves little and is not shown to the plan. */
export const LEAGUE_MIN_PLAYED = 8

/** One public match between two real teams (no AI side), as read from FoxLeague's history and statistics. */
export interface LeagueMatch {
  key: string
  at: string
  kind: string
  homeUserId: number
  awayUserId: number
  home: string
  away: string
  homeScore: number
  awayScore: number
  /** Each eleven's strength as it played; null for a ranked match read too long after it (FoxLeague rebuilds it then). */
  homeStrength: number | null
  awayStrength: number | null
  homeElo: number | null
  awayElo: number | null
}

/** Where the league matches are kept between plans, with the next team to read and the owner's own teams. */
export interface LeagueCache {
  has(key: string): boolean
  put(m: LeagueMatch): void
  cursor(): number
  setCursor(n: number): void
  own(): Set<number>
}

export interface LeagueTable {
  matches: number
  teams: number
  /** Matches whose two strengths are known (the ones in a strength band). */
  withStrength: number
  rows: FormationRecordRow[]
  /** The formations played, each side of each match once, most common first. */
  field: { formation: string; matches: number }[]
}

const edgeOf = (mine: number | null, theirs: number | null) => (typeof mine === 'number' && typeof theirs === 'number' && theirs > 0 ? ((mine - theirs) / theirs) * 100 : null)
const gapOf = (mine: number | null, theirs: number | null) => (typeof mine === 'number' && typeof theirs === 'number' ? mine - theirs : null)

/**
 * The league's results by formation pair: each match from both sides, the matches of the owner's teams left out (their
 * own and pooled records hold them). A same-formation pairing wins exactly as often as it loses, so its rows are left
 * out; its formations still count in the field.
 */
export function leagueTable(matches: LeagueMatch[], own: Set<number>): LeagueTable {
  const kept = matches.filter(m => !own.has(m.homeUserId) && !own.has(m.awayUserId))
  const games: FormationMatch[] = kept.flatMap(m => [
    { key: m.key, at: m.at, mine: m.home, theirs: m.away, gf: m.homeScore, ga: m.awayScore, edge: edgeOf(m.homeStrength, m.awayStrength), rivalUserId: m.awayUserId, eloGap: gapOf(m.homeElo, m.awayElo) },
    { key: m.key, at: m.at, mine: m.away, theirs: m.home, gf: m.awayScore, ga: m.homeScore, edge: edgeOf(m.awayStrength, m.homeStrength), rivalUserId: m.homeUserId, eloGap: gapOf(m.awayElo, m.homeElo) },
  ])
  const all = summariseFormations(games)
  return {
    matches: kept.length,
    teams: new Set(kept.flatMap(m => [m.homeUserId, m.awayUserId])).size,
    withStrength: kept.filter(m => edgeOf(m.homeStrength, m.awayStrength) !== null).length,
    rows: all.rows.filter(r => r.mine !== r.theirs),
    field: [...all.field].sort((a, b) => b.matches - a.matches || a.formation.localeCompare(b.formation)),
  }
}

// ---- the casual test bench (owner, 2026-11-04) ----

/** The bench counts the casual games of this many days; the store keeps 60. */
export const CASUAL_DAYS = 40

/**
 * The next formations to test in a casual game: every formation the squad can field (a goalkeeper and enough defenders,
 * midfielders and forwards free to play), the ones with the fewest tests on the bench first, so each formation's sample
 * grows evenly; ties in FoxLeague's order of the formations.
 */
export function formationsToTest(players: PlayerView[], bench: FormationRecord | undefined): { formation: string; tests: number }[] {
  const free = players.filter(p => !p.listed && !p.transferLockedUntil)
  const count = (position: string) => free.filter(p => p.position === position).length
  const tests = new Map((bench?.rows ?? []).map(r => [r.mine, r.played]))
  return Object.entries(FORMATION_SLOTS)
    .filter(([f, slots]) => !FORMATIONS_COMING_SOON.has(f) && count('GK') >= 1 && count('DEF') >= slots.DEF && count('MID') >= slots.MID && count('FWD') >= slots.FWD)
    .map(([formation], i) => ({ formation, tests: tests.get(formation) ?? 0, i }))
    .sort((a, b) => a.tests - b.tests || a.i - b.i)
    .map(({ formation, tests }) => ({ formation, tests }))
}
