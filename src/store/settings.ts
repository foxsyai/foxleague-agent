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
 * Five levels, from careful to all-in. Each one does everything the level below does and adds more (the manual's
 * Strategy levels page has the full grid). Every text is complete on its own: the AI only sees its own agent's.
 */
export const STRATEGY_PRESETS: Record<string, string> = {
  steady:
    'Steady (level 1 of 5): play the free game fully and spend only on modest entries. Use the 5 free training sessions every day on the starters who matter most, keep the best fit lineup and formation, play the 5 daily matches and sync before match days when the gains matter. Enter Silver tournaments and 1v1s at the lowest amounts for XP and competitive matches. No shop purchases, no auction bids, no high stakes.',
  climber:
    'Climber (level 2 of 5): everything a steady manager does, plus the push for ELO. Use the 5 free training sessions every day on the starters who matter most, keep the strongest fit lineup at all times, play ranked matches whenever allowed within the 5 daily matches and sync before match days. Enter Silver tournaments, and Gold ones when the squad can compete; play 1v1s against teams of similar or lower ELO at any of the configured amounts. Buy condition recovery only for key starters before a match that matters. No other shop purchases, no auction bids.',
  hunter:
    'Hunter (level 3 of 5): everything a climber does, plus tournaments and the first purchases. Use the 5 free training sessions every day, keep the strongest fit lineup, play ranked matches whenever allowed and sync before match days. Enter the Silver and Gold tournaments with the best expected value and create tournaments sized from what recently filled; play 1v1s against similar or weaker teams; keep condition high before match days with recovery for key starters. Buy the XP booster on days with 3 sure competitive matches and paid training slots while it runs. Fuse when three spare cards of a rarity are ready (the fee only). Bid on Rare players that clearly strengthen the starting eleven at a fair price next to the floor and other listings. No Common packs, no waivers.',
  predator:
    'Predator (level 4 of 5): everything a hunter does, plus paying for everything that grows the squad, except waivers: never a fusion match waiver, a fusion cooldown waiver or any other waiver. Use all 15 training sessions every day (5 free and the 10 paid slots) on starters below their cap, keep the strongest fit lineup, play ranked matches whenever allowed and sync before match days. Enter the Silver and Gold tournaments with the best expected value, create tournaments, play 1v1s against similar or weaker teams. Run the XP booster on every day with competitive matches and buy condition recovery whenever it lets starters train or play at full strength. Buy both Common packs every week and fuse whenever three cards of a rarity are ready, with every match really played and the 14-day cooldown waited out. Bid on Rare and Epic players that clearly strengthen the starting eleven at a fair price. Spend for growth up to the limits.',
  beast:
    'Beast (level 5 of 5): everything a predator does, plus every paid advantage: maximum growth, whatever it costs within the limits and the wallet. Use all 15 training sessions every day (5 free and the 10 paid slots) on starters below their cap, keep the strongest fit lineup, play ranked matches whenever allowed and sync before match days. Play 3 competitive matches a day in Silver and Gold tournaments and 1v1s, and create tournaments. Keep the XP booster running every day and buy condition recovery whenever condition holds back training or a match. Buy both Common packs every week and fuse every 20 hours whenever a triplet can be made, with the fusion match waiver for every missing match and the cooldown waiver down to 3 days, so fusions never wait. Bid on players of any rarity, Legendary players included, when they clearly lift the squad at a fair price. Keep at least 22 cards so the squad can rotate; once there are more than 36, list the weakest spare cards at fair reserves. Never move cards between wallets.',
}

/** The gas reserve can be lowered, never to nothing: a wallet without EGLD cannot even pay a refund claim. */
export const MIN_GAS_RESERVE_EGLD = 0.05

export const DEFAULT_SETTINGS: AgentSettings = {
  strategy: STRATEGY_PRESETS.steady!,
  dailyCapUsd: 10,
  monthlyBudgetUsd: 300,
  setupBudgetUsd: 20,
  maxEntryFeeFoxsy: 5000,
  maxShopPaymentFoxsy: 2500,
  maxSwapFoxsy: 10_000,
  maxBidFoxsy: 2500,
  egldGasReserve: '1',
  topUpWarningUsd: 10,
  entryFeesSilver: [1000, 1500, 2000, 2500, 3000],
  entryFeesGold: [5000],
  tickMinutes: 30,
  tickJitterMinutes: 10,
  activeHoursUtc: [5, 21],
  minGapSeconds: 90,
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
  const fees = (k: 'entryFeesSilver' | 'entryFeesGold', min: number, max: number): void => {
    if (!(k in raw)) return
    const v = raw[k]
    if (!Array.isArray(v) || v.length < 1 || v.length > 10 || v.some(x => typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max)) {
      throw new Error(`${k} must list 1 to 10 whole amounts between ${min} and ${max}`)
    }
    out[k] = [...new Set(v as number[])].sort((a, b) => a - b)
  }
  for (const k of Object.keys(raw)) if (!(k in DEFAULT_SETTINGS)) throw new Error(`unknown setting ${k}`)
  if ('strategy' in raw) {
    if (typeof raw.strategy !== 'string' || !raw.strategy.trim() || raw.strategy.length > 2000) throw new Error('strategy must be 1 to 2000 characters')
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
  fees('entryFeesGold', 5000, 1_000_000)
  num('tickMinutes', 5, 240, true)
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
