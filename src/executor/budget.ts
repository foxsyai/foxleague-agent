// Spending caps enforced in code (README "Caps in code, not in the prompt"). Costs are valued in
// USD at live prices: FOXSY through the xExchange spot price, EGLD through the MultiversX API.
// The budget day follows the game day (allowances reset at 14:00 UTC), so "today" means the same
// thing to the strategist, the caps and the game.

import type { Store, SpendCategory } from '../store/db.ts'
import type { AgentSettings } from '../store/settings.ts'
import { atomicToFloat } from '../util/encoding.ts'

/** The game day a moment belongs to, named by the UTC date it started on. */
export function gameDayKey(now: Date, resetHourUtc = 14): string {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), resetHourUtc))
  if (now.getTime() < start.getTime()) start.setUTCDate(start.getUTCDate() - 1)
  return start.toISOString().slice(0, 10)
}

export interface Prices {
  egldUsd: number
  foxsyUsd: number
}

export function costUsd(foxsyAtomic: bigint, egldAtomic: bigint, p: Prices): number {
  return atomicToFloat(foxsyAtomic) * p.foxsyUsd + atomicToFloat(egldAtomic) * p.egldUsd
}

export interface BudgetView {
  gameDay: string
  month: string
  dailyCapUsd: number
  spentTodayUsd: number
  remainingTodayUsd: number
  monthlyBudgetUsd: number
  spentMonthUsd: number
  remainingMonthUsd: number
  setupBudgetUsd: number
  spentSetupUsd: number
  remainingSetupUsd: number
  /**
   * The EGLD (and WEGLD) swapped away, in USD, this game day and this calendar month, against the executor's swap
   * allowances: the daily cap and the monthly budget (each at least the setup budget before registration).
   */
  swappedTodayUsd: number
  swapAllowanceTodayUsd: number
  remainingSwapTodayUsd: number
  swappedMonthUsd: number
  swapAllowanceMonthUsd: number
  remainingSwapMonthUsd: number
  /** Which ledger these figures come from. */
  dryRun: boolean
}

/**
 * `registered`: whether the team exists, which sets the swap allowances as the executor does (its own swap check
 * reads the same ledger rows; this view only tells the plan what is left).
 */
export function budgetView(store: Store, agentIndex: number, settings: AgentSettings, dryRun: boolean, now: Date, resetHourUtc = 14, registered = true): BudgetView {
  const gameDay = gameDayKey(now, resetHourUtc)
  const month = now.toISOString().slice(0, 7)
  const spentTodayUsd = store.spentUsd(agentIndex, { gameDay, category: 'play', dryRun })
  const spentMonthUsd = store.spentUsd(agentIndex, { month, category: 'play', dryRun })
  const spentSetupUsd = store.spentUsd(agentIndex, { category: 'setup', dryRun })
  const swappedTodayUsd = store.spentUsd(agentIndex, { gameDay, category: 'swap', dryRun })
  const swappedMonthUsd = store.spentUsd(agentIndex, { month, category: 'swap', dryRun })
  const swapAllowanceTodayUsd = registered ? settings.dailyCapUsd : Math.max(settings.dailyCapUsd, settings.setupBudgetUsd)
  const swapAllowanceMonthUsd = registered ? settings.monthlyBudgetUsd : Math.max(settings.monthlyBudgetUsd, settings.setupBudgetUsd)
  return {
    gameDay,
    month,
    dailyCapUsd: settings.dailyCapUsd,
    spentTodayUsd,
    remainingTodayUsd: Math.max(0, settings.dailyCapUsd - spentTodayUsd),
    monthlyBudgetUsd: settings.monthlyBudgetUsd,
    spentMonthUsd,
    remainingMonthUsd: Math.max(0, settings.monthlyBudgetUsd - spentMonthUsd),
    setupBudgetUsd: settings.setupBudgetUsd,
    spentSetupUsd,
    remainingSetupUsd: Math.max(0, settings.setupBudgetUsd - spentSetupUsd),
    swappedTodayUsd,
    swapAllowanceTodayUsd,
    remainingSwapTodayUsd: Math.max(0, swapAllowanceTodayUsd - swappedTodayUsd),
    swappedMonthUsd,
    swapAllowanceMonthUsd,
    remainingSwapMonthUsd: Math.max(0, swapAllowanceMonthUsd - swappedMonthUsd),
    dryRun,
  }
}

/** null when the spend fits every cap, else the refusal. */
export function capRefusal(view: BudgetView, category: SpendCategory, usd: number): string | null {
  if (usd <= 0) return null
  const fmt = (n: number) => `$${n.toFixed(2)}`
  if (category === 'setup') {
    return usd > view.remainingSetupUsd ? `setup budget: ${fmt(usd)} needed, ${fmt(view.remainingSetupUsd)} of ${fmt(view.setupBudgetUsd)} left` : null
  }
  if (usd > view.remainingTodayUsd) return `daily cap: ${fmt(usd)} needed, ${fmt(view.remainingTodayUsd)} of ${fmt(view.dailyCapUsd)} left today`
  if (usd > view.remainingMonthUsd) return `monthly budget: ${fmt(usd)} needed, ${fmt(view.remainingMonthUsd)} of ${fmt(view.monthlyBudgetUsd)} left`
  return null
}
