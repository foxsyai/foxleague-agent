// Per-agent behaviour settings (README "Behaviour settings"). Every range is the player's choice;
// the PoC uses the same knobs.

export interface AgentSettings {
  /** Free-text direction for the strategist (preset or the owner's own words). */
  strategy: string
  /** Spending caps. The executor enforces them; the model only sees what is left. */
  dailyCapUsd: number
  monthlyBudgetUsd: number
  /** One-time setup budget: registration fee, its swap and gas (not part of the daily cap). */
  setupBudgetUsd: number
  maxEntryFeeFoxsy: number
  maxShopPaymentFoxsy: number
  /** Largest single marketplace bid, in FOXSY. */
  maxBidFoxsy: number
  /**
   * Largest bid per rarity, in FOXSY, under the max bid: the owner's limits (2026-10-24; since 2026-11-22 by the owner's
   * rule, BIDS-1). A card is three of the rarity below fused, so each limit is three times the one below plus 5 percent,
   * from a Common at 525 (rounded): Uncommon 1,650, Rare 5,200, Epic 16,400, Legendary 51,700. The Common itself stays
   * at 500, a pack card's price (2,500 for 5), so the agent never pays more for one than the shop charges. Every limit
   * stays under what the card costs to build with its matches (the build ceiling, auctionCeiling).
   */
  maxBidCommonFoxsy: number
  maxBidUncommonFoxsy: number
  maxBidRareFoxsy: number
  maxBidEpicFoxsy: number
  maxBidLegendaryFoxsy: number
  /** Largest single EGLD -> FOXSY swap, in FOXSY. */
  maxSwapFoxsy: number
  /** EGLD kept for gas: a swap that would leave less is refused; transaction fees may use it. */
  egldGasReserve: string
  /** The owner is told when the wallet's EGLD and FOXSY together are worth less than this (USD); 0 switches it off. */
  topUpWarningUsd: number
  /** Round entry amounts to choose from when creating (never odd numbers like 1,246). */
  /** Round amounts for a Bronze it creates; empty: it creates none. */
  entryFeesBronze: number[]
  entryFeesSilver: number[]
  entryFeesGold: number[]
  /** Timing. */
  tickMinutes: number
  tickJitterMinutes: number
  /** Active window in UTC hours [from, to). */
  activeHoursUtc: [number, number]
  minGapSeconds: number
  /** Chance (0..1) that a planned discretionary action is carried out, so the agent is not clockwork. */
  actionProbability: number
  /** The level's counts (owner, 2026-11-06): paid training sessions a game day (FoxLeague allows 10). */
  paidTrainingPerDay: number
  /** XP boosters in any 7 days, counted from the agent's own purchases (one runs 24 hours, so 7 is every day). */
  boostersPerWeek: number
  /** Common packs in any 7 days (FoxLeague allows 2 a wallet a week). */
  packsPerWeek: number
  /**
   * Days of injury medicine in any 7 days, over all cards, counted from the agent's own purchases (owner,
   * 2026-11-10: a count per level, like the boosters). 0 buys none. An agent saved before it existed reads 0: it
   * could buy no medicine before, and a count above 0 is the owner's to set.
   */
  medicineDaysPerWeek: number
  /**
   * The AI this agent plays with (the owner, 2026-11-13): its own model id and its own effort, each empty for "the
   * same as all agents" (the Strategist box), which is the default and what an agent saved before them reads. The
   * strategist reads them through agentChoice (src/strategist/strategist.ts): a value it does not know is never used.
   */
  aiModel: string
  aiEffort: string
}

/** The efforts an AI request takes, from the least to the most thinking (the strategist's EFFORTS is this list). */
export const AI_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const

/**
 * The AI of a new install (the owner, 2026-11-20): Claude Haiku 5.5 at high effort, the model AGENT_MODEL falls back to
 * (src/config.ts) and the effort strategistChoice gives it while nothing names an effort. Until then a new install
 * played Sonnet 5.5 at medium. The owner's ten agents played Haiku, Sonnet and Opus 5.5 at high for a week: the same
 * share of competitive matches won, Haiku at about a third of Sonnet's AI cost a day and a sixth of Opus's, and each
 * of its slips refused by the code before a payment. Sonnet 5.5, Opus 5.5 and Fable 5.2 stay choices.
 */
export const DEFAULT_AI = { model: 'claude-haiku-5-5', effort: 'high' } as const

/** The most medicine days a week a setting takes (three of the longest injuries' 18 days and some). */
export const MAX_MEDICINE_DAYS_PER_WEEK = 60

/**
 * The counts an agent saved before they existed (2026-11-06) reads: FoxLeague's own maximum, so nothing changes for an
 * agent until its owner picks a level again or lowers them (a new agent stores the steady level's).
 */
export const FOXLEAGUE_MAX_COUNTS: Pick<AgentSettings, 'paidTrainingPerDay' | 'boostersPerWeek' | 'packsPerWeek'> = { paidTrainingPerDay: 10, boostersPerWeek: 7, packsPerWeek: 2 }

/**
 * One brain for every level (owner, 2026-11-06): every level reads the same strategy core, the one Zeus had; the levels
 * differ only in money (the caps, the largest payments, the bid limits and the counts below) and in how often they
 * plan. Every text is complete on its own: the AI only sees its own agent's.
 */
export const STRATEGY_CORE =
  'The aim is No. 1 on the leaderboard with the least spending that gets there, within this level\'s limits (the budget section shows them). Every part of FoxLeague is open: ranked and casual games, join and create tournaments (public or private), 1v1s (against a named team or as an open challenge) and the marketplace. Every action must name its benefit (ELO, rank, XP or card value) against its cost and risk; without a clear benefit the right move is to wait. Climb in steps: a new team starts at 1200 ELO with a starter squad, so begin with the teams you beat, build ELO and XP from those wins and move up to stronger teams as the squad and the win chance allow (a win over a stronger team pays more ELO). Decide from the numbers: the engine facts, the win chance shown for each team (ELO and lineup strength: yours at today\'s condition, theirs at full condition) and how often a team plays and takes 1v1s. Play 1v1s only when the win chance is good, at the stake that chance justifies: against a named active team that takes 1v1s it had not arranged, as an open challenge topped at your own best XI OVR or by taking an open challenge another team posted. Enter a tournament only with a real chance of the top three and when the expected prize plus the XP is worth the fee; create tournaments sized to the active teams that will join; create private ones that invite active teams you should beat but that still see a chance, enough of them to reach the minimum. Ranked matches move ELO less than a Silver or Gold match and earn less XP: play them while the squad is fit and no better match needs its condition. Before every match lock, set the formation and the eleven against that opponent\'s formation and strengths. Train each starter on the stats its role needs (keeper defense; defenders defense, power and speed; midfielders control, vision, accuracy and stamina; forwards speed, power and control), never a stat at its cap; buy paid slots only when they beat every other use of that FOXSY. Sync only when the synced gains change a match that counts. Condition multiplies every stat: buy recovery only for key starters before a match that matters and rotate the bench to keep them fresh. Buy a player of any rarity only at a good price and for a reason that pays: a fusion input, a resale margin or a clear upgrade of the eleven per FOXSY; list spare cards when their price beats their use. Fuse when the fees and waivers pay back in strength or value. Run the XP booster only on days with 3 sure competitive matches and starters below their cap. Play at least every 10 days so ELO never decays. Grow the squad toward 22 cards so it can rotate, as the budget allows. Every other team is a rival: never arrange a result. Never move cards between wallets.'

const LEVEL_HEADS: Record<string, string> = {
  steady: 'Steady (level 1 of 6), the smallest budget:',
  climber: 'Climber (level 2 of 6), a small budget:',
  hunter: 'Hunter (level 3 of 6), a medium budget:',
  predator: 'Predator (level 4 of 6), a larger budget:',
  beast: 'Beast (level 5 of 6), a large budget:',
  zeus: 'Zeus (level 6 of 6), the largest budget:',
}

export const STRATEGY_PRESETS: Record<string, string> = Object.fromEntries(Object.entries(LEVEL_HEADS).map(([level, head]) => [level, `${head} ${STRATEGY_CORE}`]))

/**
 * The AI the levels play best with: one brain, so one recommendation, the AI of a new install (DEFAULT_AI, since
 * 2026-11-20; Opus 5.5 at high before); how often a level plans sets what it costs. It is shown next to the level,
 * never switched: the Strategist box sets the model for every agent without its own.
 */
export const LEVEL_AI: Record<string, { model: string; effort: 'medium' | 'high' }> = Object.fromEntries(Object.keys(LEVEL_HEADS).map(level => [level, { model: DEFAULT_AI.model, effort: DEFAULT_AI.effort }]))

/** The gas reserve can be lowered, never to nothing: a wallet without EGLD cannot even pay a refund claim. */
export const MIN_GAS_RESERVE_EGLD = 0.05

/** The shortest cycle: with at most about 20 actions a cycle and 30 s between them, 10 minutes is the floor. */
export const MIN_TICK_MINUTES = 10
/** The longest cycle: a snapshot rendered without an agent's tick (no plan) gives its starts for this one (R74A-2). */
export const MAX_TICK_MINUTES = 240

/** What a strategy level sets when the owner picks it (the manual's Strategy levels page lists them). */
export type LevelSettings = Pick<AgentSettings, 'dailyCapUsd' | 'monthlyBudgetUsd' | 'topUpWarningUsd' | 'maxEntryFeeFoxsy' | 'maxShopPaymentFoxsy' | 'maxSwapFoxsy' | 'maxBidFoxsy' | 'entryFeesSilver' | 'entryFeesGold' | 'tickMinutes' | 'paidTrainingPerDay' | 'boostersPerWeek' | 'packsPerWeek' | 'medicineDaysPerWeek'>

/**
 * Default limits per level, from what the owner's agents spent per game day at each level in October 2026 (FOXSY
 * about $0.0027): a daily cap over each level's largest allowed entry (a Gold entry must fit in one day), a monthly
 * budget near 30 days of its real use, and a top-up warning at two days of play at the daily cap. Silver
 * amounts grow by two steps a level up to the 4,999 Silver ceiling; no Gold amounts (steady) turn Gold off.
 * Since 2026-11-06 (owner: one brain, the levels differ in money) every level bids, on any rarity within its max bid
 * and the limit per rarity (the max bid reaches a Common's price at steady, an Uncommon's at climber, a Rare's at
 * hunter, an Epic's at predator and beast, a Legendary's at Zeus), and the counts grow with the level: paid training
 * sessions a day, XP boosters and Common packs a week, and the days of injury medicine a week (none at steady, then
 * 2, 4 and 6, the whole of a light and of a medium injury, 12 at beast and 18 at Zeus, the whole of a serious one).
 * The largest single shop payment opens the booster (2,000) at
 * climber, a pack (2,500) at hunter, a Rare's match waivers (3,000) at predator and an Epic's (9,000) at beast; each
 * level's busy day (entries, tickets, syncs, recovery, its slots, booster and pack) fits its daily cap.
 */
export const LEVEL_SETTINGS: Record<string, LevelSettings> = {
  steady: { dailyCapUsd: 5, monthlyBudgetUsd: 150, topUpWarningUsd: 10, maxEntryFeeFoxsy: 1500, maxShopPaymentFoxsy: 500, maxSwapFoxsy: 10_000, maxBidFoxsy: 500, entryFeesSilver: [1000, 1500], entryFeesGold: [], tickMinutes: 120, paidTrainingPerDay: 2, boostersPerWeek: 0, packsPerWeek: 0, medicineDaysPerWeek: 0 },
  climber: { dailyCapUsd: 15, monthlyBudgetUsd: 250, topUpWarningUsd: 30, maxEntryFeeFoxsy: 5000, maxShopPaymentFoxsy: 2000, maxSwapFoxsy: 10_000, maxBidFoxsy: 1650, entryFeesSilver: [1000, 1500, 2000, 2500], entryFeesGold: [5000], tickMinutes: 120, paidTrainingPerDay: 4, boostersPerWeek: 1, packsPerWeek: 0, medicineDaysPerWeek: 2 },
  hunter: { dailyCapUsd: 25, monthlyBudgetUsd: 400, topUpWarningUsd: 50, maxEntryFeeFoxsy: 7500, maxShopPaymentFoxsy: 2500, maxSwapFoxsy: 10_000, maxBidFoxsy: 5200, entryFeesSilver: [1000, 1500, 2000, 2500, 3000, 3500], entryFeesGold: [5000, 7500], tickMinutes: 90, paidTrainingPerDay: 6, boostersPerWeek: 2, packsPerWeek: 1, medicineDaysPerWeek: 4 },
  predator: { dailyCapUsd: 50, monthlyBudgetUsd: 750, topUpWarningUsd: 100, maxEntryFeeFoxsy: 10_000, maxShopPaymentFoxsy: 3000, maxSwapFoxsy: 20_000, maxBidFoxsy: 16_400, entryFeesSilver: [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500], entryFeesGold: [5000, 7500, 10_000], tickMinutes: 90, paidTrainingPerDay: 8, boostersPerWeek: 3, packsPerWeek: 2, medicineDaysPerWeek: 6 },
  beast: { dailyCapUsd: 100, monthlyBudgetUsd: 2_000, topUpWarningUsd: 200, maxEntryFeeFoxsy: 20_000, maxShopPaymentFoxsy: 9000, maxSwapFoxsy: 40_000, maxBidFoxsy: 16_400, entryFeesSilver: [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 4999], entryFeesGold: [5000, 7500, 10_000, 15_000, 20_000], tickMinutes: 75, paidTrainingPerDay: 10, boostersPerWeek: 7, packsPerWeek: 2, medicineDaysPerWeek: 12 },
  zeus: { dailyCapUsd: 150, monthlyBudgetUsd: 3_000, topUpWarningUsd: 300, maxEntryFeeFoxsy: 25_000, maxShopPaymentFoxsy: 9000, maxSwapFoxsy: 50_000, maxBidFoxsy: 51_700, entryFeesSilver: [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 4999], entryFeesGold: [5000, 7500, 10_000, 15_000, 20_000, 25_000], tickMinutes: 60, paidTrainingPerDay: 10, boostersPerWeek: 7, packsPerWeek: 2, medicineDaysPerWeek: 18 },
}

/**
 * Every new agent: the steady level, active 16 hours around the 14:00 UTC game-day reset (06:00 to 22:00, HOURS-1), a
 * cycle every 2 hours give or take 10 minutes (8 plans a day; the daily-capped play fits in them), 30 s between
 * actions, every planned action carried out.
 */
export const DEFAULT_SETTINGS: AgentSettings = {
  strategy: STRATEGY_PRESETS.steady!,
  ...LEVEL_SETTINGS.steady!,
  entryFeesBronze: [100, 250, 500],
  maxBidCommonFoxsy: 500,
  maxBidUncommonFoxsy: 1650,
  maxBidRareFoxsy: 5200,
  maxBidEpicFoxsy: 16_400,
  maxBidLegendaryFoxsy: 51_700,
  setupBudgetUsd: 20,
  egldGasReserve: '1',
  tickJitterMinutes: 10,
  activeHoursUtc: [6, 22],
  minGapSeconds: 30,
  actionProbability: 1,
  aiModel: '',
  aiEffort: '',
}

/**
 * Validates a settings change from the web UI: known fields only, each within its range.
 * Throws with the first problem; returns the typed patch.
 */
export function validateSettingsPatch(raw: Record<string, unknown>): Partial<AgentSettings> {
  const out: Partial<AgentSettings> = {}
  const num = (k: keyof AgentSettings, min: number, max: number, integer = false): void => {
    if (!(k in raw)) return
    const v = raw[k]
    if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) {
      throw new Error(`${k} must be ${integer ? 'a whole number' : 'a number'} between ${min} and ${max}`)
    }
    ;(out as Record<string, unknown>)[k] = v
  }
  // Silver needs at least one amount; an empty Gold list turns Gold off for the agent, an empty Bronze list its Bronze creates.
  const fees = (k: 'entryFeesBronze' | 'entryFeesSilver' | 'entryFeesGold', min: number, max: number, least = 1): void => {
    if (!(k in raw)) return
    const v = raw[k]
    if (!Array.isArray(v) || v.length < least || v.length > 10 || v.some(x => typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max)) {
      throw new Error(`${k} must list ${least} to 10 whole amounts between ${min} and ${max}`)
    }
    out[k] = [...new Set(v as number[])].sort((a, b) => a - b)
  }
  for (const k of Object.keys(raw)) if (!(k in DEFAULT_SETTINGS)) throw new Error(`unknown setting ${k}`)
  if ('strategy' in raw) {
    if (typeof raw.strategy !== 'string' || !raw.strategy.trim() || raw.strategy.length > 3000) throw new Error('strategy must be 1 to 3000 characters')
    out.strategy = raw.strategy.trim()
  }
  num('dailyCapUsd', 0, 1000)
  num('monthlyBudgetUsd', 0, 10_000)
  num('setupBudgetUsd', 0, 200)
  num('topUpWarningUsd', 0, 10_000)
  num('maxEntryFeeFoxsy', 0, 100_000, true)
  num('maxShopPaymentFoxsy', 0, 100_000, true)
  num('maxSwapFoxsy', 100, 1_000_000, true)
  num('maxBidFoxsy', 0, 1_000_000, true)
  num('maxBidCommonFoxsy', 0, 1_000_000, true)
  num('maxBidUncommonFoxsy', 0, 1_000_000, true)
  num('maxBidRareFoxsy', 0, 1_000_000, true)
  num('maxBidEpicFoxsy', 0, 1_000_000, true)
  num('maxBidLegendaryFoxsy', 0, 1_000_000, true)
  if ('egldGasReserve' in raw) {
    const v = raw.egldGasReserve
    if (typeof v !== 'string' || !/^\d{1,2}(\.\d{1,4})?$/.test(v) || Number(v) > 10 || Number(v) < MIN_GAS_RESERVE_EGLD) throw new Error(`egldGasReserve must be a decimal EGLD amount from ${MIN_GAS_RESERVE_EGLD} to 10`)
    out.egldGasReserve = v
  }
  fees('entryFeesBronze', 100, 999, 0)
  fees('entryFeesSilver', 1000, 4999)
  fees('entryFeesGold', 5000, 1_000_000, 0)
  num('tickMinutes', MIN_TICK_MINUTES, MAX_TICK_MINUTES, true)
  num('tickJitterMinutes', 0, 60, true)
  if ('activeHoursUtc' in raw) {
    const v = raw.activeHoursUtc
    // From 0 to 23 and to 1 to 24, as the dashboard's fields: [24, 0] would be a window that never opens (OPEN-5).
    if (!Array.isArray(v) || v.length !== 2 || !v.every(x => Number.isInteger(x)) || v[0] < 0 || v[0] > 23 || v[1] < 1 || v[1] > 24 || v[0] === v[1]) throw new Error('activeHoursUtc must be [from, to]: from 0-23, to 1-24')
    out.activeHoursUtc = [v[0] as number, v[1] as number]
  }
  num('minGapSeconds', 30, 3600, true)
  num('actionProbability', 0, 1)
  num('paidTrainingPerDay', 0, FOXLEAGUE_MAX_COUNTS.paidTrainingPerDay, true)
  num('boostersPerWeek', 0, FOXLEAGUE_MAX_COUNTS.boostersPerWeek, true)
  num('packsPerWeek', 0, FOXLEAGUE_MAX_COUNTS.packsPerWeek, true)
  num('medicineDaysPerWeek', 0, MAX_MEDICINE_DAYS_PER_WEEK, true)
  // Empty is "the same as all agents". The shape of a model id only: whether the list has it is the web route's check.
  if ('aiModel' in raw) {
    const v = raw.aiModel
    if (typeof v !== 'string' || (v !== '' && !/^[a-z0-9][a-z0-9.-]{0,59}$/.test(v))) throw new Error('aiModel must be empty (same as all agents) or a model id')
    out.aiModel = v
  }
  if ('aiEffort' in raw) {
    const v = raw.aiEffort
    if (typeof v !== 'string' || (v !== '' && !(AI_EFFORTS as readonly string[]).includes(v))) throw new Error(`aiEffort must be empty (same as all agents) or one of ${AI_EFFORTS.join(', ')}`)
    out.aiEffort = v
  }
  return out
}

/** Checks a whole settings object: the random part of a cycle may never bring it under the 10-minute floor. */
export function checkTiming(s: AgentSettings): void {
  if (s.tickMinutes - s.tickJitterMinutes < MIN_TICK_MINUTES) {
    throw new Error(`the random window (±${s.tickJitterMinutes} min) would bring a ${s.tickMinutes}-minute cycle under ${MIN_TICK_MINUTES} minutes: lower it to ${Math.max(0, s.tickMinutes - MIN_TICK_MINUTES)} or less`)
  }
}
