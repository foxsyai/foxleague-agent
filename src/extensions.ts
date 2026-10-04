// Optional extensions of one install. When src/local/index.ts exists, its register() runs at start and may
// fill these hooks; on an install without it they stay empty and change nothing.

import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { PlannedAction } from './executor/actions.ts'
import type { AgentSnapshot } from './snapshot/snapshot.ts'
import type { AgentSettings } from './store/settings.ts'

export interface Extensions {
  /**
   * Right before an action runs, may turn it into smaller actions of the same kind, each marked `piece`. Every
   * piece then runs on its own: checked, paid and confirmed like any action, at the plan's usual spacing.
   */
  splitAction?: (planned: PlannedAction, snapshot: AgentSnapshot, settings: AgentSettings) => PlannedAction[] | null
}

export const extensions: Extensions = {}

/** Loads src/local/index.ts when it is there; returns what it switched on, for the start message. */
export async function loadExtensions(): Promise<string[]> {
  const url = new URL('./local/index.ts', import.meta.url)
  if (!existsSync(fileURLToPath(url))) return []
  const m = (await import(url.href)) as { register?: (e: Extensions) => unknown }
  const on = m.register?.(extensions)
  return Array.isArray(on) ? on.map(String) : []
}
