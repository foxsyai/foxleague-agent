// Helpers of the tests of the Windows real-PC re-test of 2026-11-14 (test/win-1114/).
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { UpdateView } from '../../src/update/updater.ts'
import { REPO } from '../update-fixtures.ts'

export const raw = (f: string): string => readFileSync(join(REPO, f), 'utf8')
export const flat = (f: string): string => raw(f).replace(/\s+/g, ' ')

/** What the dashboard holds for an install that runs 1.0.1 under a service manager, with nothing on offer. */
export const IDLE: UpdateView = { installed: '1.0.1', available: null, checkedAt: null, checkError: null, canInstall: true, how: null, state: 'idle', last: null, enabled: true, restarts: true, waiting: null }

type Control = { hidden: boolean; textContent: string; className: string; disabled: boolean }
export interface UpdatePage {
  S: { instance: { update: UpdateView } }
  toasts: [string, boolean][]
  /** Sets what the agent answers (as loadState does) and renders the notice. */
  set(update: Partial<UpdateView>): void
  render(): void
  startUpdate(): Promise<void>
  text(): string
  button(): boolean
  label(): string
  tone(): string
}

/**
 * The dashboard's own update code, from renderUpdate to the end of startUpdate (Check for updates sits between
 * them), on stand-in elements, with a stand-in api, toast and loadState. The polling of startUpdate is held: the
 * test sets each answer of the agent itself.
 */
export function updatePage(update: Partial<UpdateView>, o: { api?: (method: string, path: string) => Promise<unknown> } = {}): UpdatePage {
  const html = raw('src/web/dashboard.html')
  const code = html.slice(html.indexOf('function renderUpdate() {'), html.indexOf('function renderHeader() {'))
  assert.ok(code.startsWith('function renderUpdate()'), 'renderUpdate was not found in the dashboard')
  assert.ok(code.includes('async function startUpdate() {'), 'startUpdate was not found after renderUpdate')
  const els: Record<string, Control> = {}
  const $ = (id: string): Control => (els[id] ??= { hidden: false, textContent: '', className: '', disabled: false })
  const S = { instance: { update: { ...IDLE, ...update } } }
  const toasts: [string, boolean][] = []
  const api = o.api ?? (async () => ({ message: 'Installing.' }))
  const fns = new Function('S', '$', 'toast', 'updating', 'api', 'loadState', 'setInterval', 'clearInterval', `${code}\nreturn { renderUpdate, startUpdate }`)(
    S, $, (m: string, bad?: boolean) => void toasts.push([m, Boolean(bad)]), null, api, async () => undefined, () => 1, () => undefined,
  ) as { renderUpdate: () => void; startUpdate: () => Promise<void> }
  fns.renderUpdate()
  return {
    S,
    toasts,
    set(next) {
      S.instance.update = { ...S.instance.update, ...next }
      fns.renderUpdate()
    },
    render: () => fns.renderUpdate(),
    startUpdate: () => fns.startUpdate(),
    text: () => $('upText').textContent,
    button: () => !$('upBtn').hidden,
    label: () => $('upBtn').textContent,
    tone: () => $('upBanner').className,
  }
}
