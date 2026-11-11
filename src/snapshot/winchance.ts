// A first estimate of the chance to win a match against one team, from the two numbers the agent can read: ELO
// (FoxLeague's own rating, so the classic ELO expectation) and lineup strength (the eleven's synced stats scaled
// by condition, as the match engine scales them). Every 1v1 records the estimate it was taken at, so the curve can
// be calibrated on real results; until then it is a guide, not a promise.

/** How steeply the squad ratio turns into a chance: a squad 10 percent stronger wins about 68 percent of the time. */
const SQUAD_K = 8

/**
 * The chance (0 to 1) to beat a team, or null when neither number is known. With both read it is the smaller of their
 * average and the squad-only chance (the owner's decision, 2026-11-11; audit 2026-11-11, MONEY-2): ELO is the one
 * number a rival controls downward (a new team starts at 1200, a team can lose on purpose), so a rival's lower ELO
 * may lower our chance and never lift it above what the two elevens alone give. With one number read the chance is
 * that number's.
 */
export function winChance(o: { myElo: number | null; oppElo: number | null; myStrength: number | null; oppStrength: number | null }): number | null {
  const byElo = o.myElo !== null && o.oppElo !== null ? 1 / (1 + 10 ** ((o.oppElo - o.myElo) / 400)) : null
  const bySquad = o.myStrength && o.oppStrength ? 1 / (1 + (o.oppStrength / o.myStrength) ** SQUAD_K) : null
  if (byElo === null && bySquad === null) return null
  const p = byElo === null ? bySquad! : bySquad === null ? byElo : Math.min((byElo + bySquad) / 2, bySquad)
  return Math.round(p * 100) / 100
}

/** A chance as people read it: "62 percent". */
export function percent(p: number | null): string {
  return p === null ? 'unknown' : `${Math.round(p * 100)} percent`
}
