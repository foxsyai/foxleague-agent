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
  /** Largest single EGLD -> FOXSY swap, in FOXSY. */
  maxSwapFoxsy: number
  /** EGLD kept for gas: a swap that would leave less is refused; transaction fees may use it. */
  egldGasReserve: string
  /** The owner is told when the wallet's EGLD and FOXSY together are worth less than this (USD); 0 switches it off. */
  topUpWarningUsd: number
  /** Round entry amounts to choose from when creating (never odd numbers like 1,246). */
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
}

/**
 * Six levels, from careful to all-in, then Zeus. Each of the first five does everything the level below does and
 * adds more; Zeus may do everything a beast does but only what pays, aiming at No. 1 (the manual's Strategy levels
 * page has the full grid). Every text is complete on its own: the AI only sees its own agent's.
 */
export const STRATEGY_PRESETS: Record<string, string> = {
  steady:
    'Steady (level 1 of 6): play the free game fully and spend only on modest entries. Use the 5 free training sessions every day on the starters who matter most, keep the best fit lineup and formation, play the 5 daily matches and sync before match days when the gains matter. Enter Silver tournaments and 1v1s at the lowest amounts for XP and competitive matches. No shop purchases, no auction bids, no high stakes.',
  climber:
    'Climber (level 2 of 6): everything a steady manager does, plus the push for ELO. Use the 5 free training sessions every day on the starters who matter most, keep the strongest fit lineup at all times, play ranked matches whenever allowed within the 5 daily matches and sync before match days. Enter Silver tournaments, and Gold ones when the squad can compete; play 1v1s against teams of similar or lower ELO at any of the configured amounts. Buy condition recovery only for key starters before a match that matters. No other shop purchases, no auction bids.',
  hunter:
    'Hunter (level 3 of 6): everything a climber does, plus tournaments and the first purchases. Use the 5 free training sessions every day, keep the strongest fit lineup, play ranked matches whenever allowed and sync before match days. Enter the Silver and Gold tournaments with the best expected value and create tournaments sized from what recently filled; play 1v1s against similar or weaker teams; keep condition high before match days with recovery for key starters. Buy the XP booster on days with 3 sure competitive matches and paid training slots while it runs. Fuse when three spare cards of a rarity are ready (the fee only). Bid on Rare, Epic or Legendary players, never Common or Uncommon ones (packs and fusion make those), when they clearly strengthen the starting eleven at a fair price next to the floor and other listings; the max bid decides which are in reach. No Common packs, no waivers.',
  predator:
    'Predator (level 4 of 6): everything a hunter does, plus paying for everything that grows the squad, except waivers: never a fusion match waiver, a fusion cooldown waiver or any other waiver. Use all 15 training sessions every day (5 free and the 10 paid slots) on starters below their cap, keep the strongest fit lineup, play ranked matches whenever allowed and sync before match days. Enter the Silver and Gold tournaments with the best expected value, create tournaments, play 1v1s against similar or weaker teams. Run the XP booster on every day with competitive matches and buy condition recovery whenever it lets starters train or play at full strength. Buy both Common packs every week and fuse whenever three cards of a rarity are ready, with every match really played and the 14-day cooldown waited out. Bid on Rare, Epic or Legendary players, never Common or Uncommon ones (packs and fusion make those), when they clearly strengthen the starting eleven at a fair price next to the floor and other listings; the max bid decides which are in reach. Spend for growth up to the limits.',
  beast:
    'Beast (level 5 of 6): everything a predator does, plus every paid advantage: maximum growth, whatever it costs within the limits and the wallet. Use all 15 training sessions every day (5 free and the 10 paid slots) on starters below their cap, keep the strongest fit lineup, play ranked matches whenever allowed and sync before match days. Play 3 competitive matches a day in Silver and Gold tournaments and 1v1s, and create tournaments. Keep the XP booster running every day and buy condition recovery whenever condition holds back training or a match. Buy both Common packs every week and fuse every 20 hours whenever a triplet can be made, with the fusion match waiver for every missing match and the cooldown waiver down to 3 days, so fusions never wait. Bid on Rare, Epic or Legendary players, never Common or Uncommon ones (packs and fusion make those), when they clearly strengthen the starting eleven at a fair price next to the floor and other listings; the max bid decides which are in reach. Keep at least 22 cards so the squad can rotate; once there are more than 36, list the weakest spare cards at fair reserves. Never move cards between wallets.',
  zeus:
    'Zeus (level 6 of 6): the aim is No. 1 on the leaderboard with the least spending that gets there. Everything a beast may do, but only when it pays: every action must name its benefit (ELO, rank, XP or card value) against its cost and risk, and without a clear benefit the right move is to wait. Climb in steps: a new team starts at 1200 ELO with a starter squad, so begin with the teams you beat, build ELO and XP from those wins, and move up to stronger teams as the squad and the win chance allow (a win over a stronger team pays more ELO). Decide from the numbers: the win chance shown for each team (ELO and lineup strength: yours at today\'s condition, theirs at full condition), how often a team plays and accepts 1v1s, and the engine facts. Play 1v1s only against active teams that accept them and only when the win chance is good, at the stake that chance justifies. Enter a tournament only with a real chance of the top three and when the expected prize plus the XP is worth the fee; create tournaments sized to the active teams that will join, and private ones that invite active teams you should beat but that still see a chance, enough of them to reach the minimum. Ranked matches move ELO the most (K 24): play all of them while the squad is fit. Before every match lock, set the formation and the eleven against that opponent\'s formation and strengths. Train each starter on the stats its role needs (keeper defense; defenders defense, power and speed; midfielders control, vision, accuracy and stamina; forwards speed, power and control), never a stat at its cap; buy paid slots only when they beat every other use of that FOXSY. Sync only when the synced gains change a match that counts. Condition multiplies every stat: buy recovery only for key starters before a match that matters and rotate the bench to keep them fresh. Buy a player only at a good price and for a reason that pays: a fusion input, a resale margin, or a clear upgrade of the eleven per FOXSY; list spare cards when their price beats their use. Fuse toward Legendary when the fees and waivers pay back in strength or value. Run the XP booster only on days with 3 sure competitive matches and starters below their cap. Play at least every 10 days so ELO never decays. Keep at least 22 cards to rotate. Every other team is a rival: never arrange a result. Never move cards between wallets.',
}

/**
 * The AI each level plays best with, against what it costs: simple decisions on the cheapest model, Zeus on the
 * strongest. The model is one setting for every agent (the Strategist box), so this is shown, never switched.
 */
export const LEVEL_AI: Record<string, { model: string; effort: 'medium' | 'high' }> = {
  steady: { model: 'claude-sonnet-5', effort: 'medium' },
  climber: { model: 'claude-sonnet-5', effort: 'medium' },
  hunter: { model: 'claude-sonnet-5-5', effort: 'high' },
  predator: { model: 'claude-opus-5-5', effort: 'medium' },
  beast: { model: 'claude-opus-5-5', effort: 'high' },
  zeus: { model: 'claude-opus-5-5', effort: 'high' },
}

/** Whether an agent plays at the Zeus level: its strategy text is (or starts like) the Zeus preset. */
export function isZeus(strategy: string): boolean {
  return /^\s*Zeus \(level 6/i.test(strategy)
}

/** The gas reserve can be lowered, never to nothing: a wallet without EGLD cannot even pay a refund claim. */
export const MIN_GAS_RESERVE_EGLD = 0.05

/** The shortest cycle: with at most about 20 actions a cycle and 30 s between them, 10 minutes is the floor. */
export const MIN_TICK_MINUTES = 10

/** What a strategy level sets when the owner picks it (the manual's Strategy levels page lists them). */
export type LevelSettings = Pick<AgentSettings, 'dailyCapUsd' | 'monthlyBudgetUsd' | 'topUpWarningUsd' | 'maxEntryFeeFoxsy' | 'maxShopPaymentFoxsy' | 'maxSwapFoxsy' | 'maxBidFoxsy' | 'entryFeesSilver' | 'entryFeesGold' | 'tickMinutes'>

/**
 * Default limits per level, from what the owner's agents spent per game day at each level in October 2026 (FOXSY
 * about $0.0027): a daily cap over each level's largest allowed entry (a Gold entry must fit in one day), a monthly
 * budget near 30 days of its real use, and a top-up warning at two days of play at the daily cap. Silver
 * amounts grow by two steps a level up to the 4,999 Silver ceiling; no Gold amounts (steady) turn Gold off and a max bid
 * of 0 turns bidding off.
 */
export const LEVEL_SETTINGS: Record<string, LevelSettings> = {
  steady: { dailyCapUsd: 5, monthlyBudgetUsd: 150, topUpWarningUsd: 10, maxEntryFeeFoxsy: 1500, maxShopPaymentFoxsy: 500, maxSwapFoxsy: 10_000, maxBidFoxsy: 0, entryFeesSilver: [1000, 1500], entryFeesGold: [], tickMinutes: 120 },
  climber: { dailyCapUsd: 15, monthlyBudgetUsd: 250, topUpWarningUsd: 30, maxEntryFeeFoxsy: 5000, maxShopPaymentFoxsy: 1000, maxSwapFoxsy: 10_000, maxBidFoxsy: 0, entryFeesSilver: [1000, 1500, 2000, 2500], entryFeesGold: [5000], tickMinutes: 120 },
  hunter: { dailyCapUsd: 25, monthlyBudgetUsd: 400, topUpWarningUsd: 50, maxEntryFeeFoxsy: 7500, maxShopPaymentFoxsy: 2500, maxSwapFoxsy: 10_000, maxBidFoxsy: 4000, entryFeesSilver: [1000, 1500, 2000, 2500, 3000, 3500], entryFeesGold: [5000, 7500], tickMinutes: 120 },
  predator: { dailyCapUsd: 35, monthlyBudgetUsd: 750, topUpWarningUsd: 70, maxEntryFeeFoxsy: 10_000, maxShopPaymentFoxsy: 2500, maxSwapFoxsy: 20_000, maxBidFoxsy: 15_000, entryFeesSilver: [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500], entryFeesGold: [5000, 7500, 10_000], tickMinutes: 120 },
  beast: { dailyCapUsd: 100, monthlyBudgetUsd: 2_000, topUpWarningUsd: 200, maxEntryFeeFoxsy: 20_000, maxShopPaymentFoxsy: 3000, maxSwapFoxsy: 40_000, maxBidFoxsy: 40_000, entryFeesSilver: [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 4999], entryFeesGold: [5000, 7500, 10_000, 15_000, 20_000], tickMinutes: 120 },
  zeus: { dailyCapUsd: 150, monthlyBudgetUsd: 3_000, topUpWarningUsd: 300, maxEntryFeeFoxsy: 25_000, maxShopPaymentFoxsy: 5000, maxSwapFoxsy: 50_000, maxBidFoxsy: 47_000, entryFeesSilver: [1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 4999], entryFeesGold: [5000, 7500, 10_000, 15_000, 20_000, 25_000], tickMinutes: 60 },
}

/**
 * Every new agent: the steady level, active 12 hours centred on the 14:00 UTC game-day reset, a cycle every 2 hours
 * give or take 10 minutes (every level: the daily-capped play fits in 6 to 8 plans), 30 s between actions, every
 * planned action carried out.
 */
export const DEFAULT_SETTINGS: AgentSettings = {
  strategy: STRATEGY_PRESETS.steady!,
  ...LEVEL_SETTINGS.steady!,
  setupBudgetUsd: 20,
  egldGasReserve: '1',
  tickJitterMinutes: 10,
  activeHoursUtc: [8, 20],
  minGapSeconds: 30,
  actionProbability: 1,
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
  // Silver needs at least one amount; an empty Gold list turns Gold off for the agent.
  const fees = (k: 'entryFeesSilver' | 'entryFeesGold', min: number, max: number, least = 1): void => {
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
  if ('egldGasReserve' in raw) {
    const v = raw.egldGasReserve
    if (typeof v !== 'string' || !/^\d{1,2}(\.\d{1,4})?$/.test(v) || Number(v) > 10 || Number(v) < MIN_GAS_RESERVE_EGLD) throw new Error(`egldGasReserve must be a decimal EGLD amount from ${MIN_GAS_RESERVE_EGLD} to 10`)
    out.egldGasReserve = v
  }
  fees('entryFeesSilver', 1000, 4999)
  fees('entryFeesGold', 5000, 1_000_000, 0)
  num('tickMinutes', MIN_TICK_MINUTES, 240, true)
  num('tickJitterMinutes', 0, 60, true)
  if ('activeHoursUtc' in raw) {
    const v = raw.activeHoursUtc
    if (!Array.isArray(v) || v.length !== 2 || !v.every(x => Number.isInteger(x) && x >= 0 && x <= 24) || v[0] === v[1]) throw new Error('activeHoursUtc must be [from, to] hours 0-24')
    out.activeHoursUtc = [v[0] as number, v[1] as number]
  }
  num('minGapSeconds', 30, 3600, true)
  num('actionProbability', 0, 1)
  return out
}

/** Checks a whole settings object: the random part of a cycle may never bring it under the 10-minute floor. */
export function checkTiming(s: AgentSettings): void {
  if (s.tickMinutes - s.tickJitterMinutes < MIN_TICK_MINUTES) {
    throw new Error(`the random window (±${s.tickJitterMinutes} min) would bring a ${s.tickMinutes}-minute cycle under ${MIN_TICK_MINUTES} minutes: lower it to ${Math.max(0, s.tickMinutes - MIN_TICK_MINUTES)} or less`)
  }
}
