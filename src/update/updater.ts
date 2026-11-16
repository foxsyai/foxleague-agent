// The running service's side of an update: look for a newer release every ten minutes, tell the owner once per
// version (dashboard and Telegram), install it when the owner asks (one click or /upgrade), restart into it and
// say how it went. It never installs by itself. The checks that decide what may be installed are in release.ts
// (signature, version, archive) and install.ts (disk); this file only orders them.

import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SOURCE, UpdateError, archiveName, downloadArchive, fetchRelease, isNewer, type FetchLike, type Manifest } from './release.ts'
import { activate, confirmStart, refreshLauncher, selfUpdateRefusal, stage, startNote, waitingRelease, type Layout, type Runner } from './install.ts'

export const CHECK_EVERY_MS = 10 * 60_000
/**
 * The shortest time between two checks that ask the release server. The dashboard's Check for updates asks on a
 * click: a check sooner than this after the last one (or while one runs) gets the last answer, so a page or a stuck
 * double click cannot hammer the server. The check every 10 to 11 minutes is far apart and never meets it.
 */
export const MIN_CHECK_GAP_MS = 15_000
/** A new release counts as started once the service has been up this long. */
export const CONFIRM_AFTER_MS = 45_000
/** The exit code that asks the service manager to start the agent again (the installer's unit restarts on it). */
export const RESTART_EXIT_CODE = 75

export interface UpdaterDeps {
  layout: Layout
  /** The running version (package.json). */
  installed: string
  keys: readonly string[]
  /** Where releases are published; AGENT_UPDATE_URL for a mirror. Whatever it is, the signature decides. */
  source?: string
  isServer: boolean
  /** Off with AGENT_UPDATE_CHECK=0: no request leaves the machine and no update is offered. */
  enabled: boolean
  dataDir: string
  kv: { get(key: string): string | null; set(key: string, value: string): void }
  /** To the owner: the log and Telegram. */
  notify(text: string): void
  /** Stops the service gracefully (running actions finish and are booked), then exits with RESTART_EXIT_CODE. */
  restart(): Promise<void>
  /**
   * False when no service manager started the agent (supervised.ts): nothing would start it again, so an update
   * is put in place and the agent plays on until its owner starts it again. Left out: true.
   */
  supervised?: boolean
  fetch?: FetchLike
  run?: Runner
  confirmAfterMs?: number
  /** Left out: MIN_CHECK_GAP_MS. */
  checkGapMs?: number
}

export interface UpdateView {
  installed: string
  /** A newer signed release, or null. */
  available: { version: string; notes: string; published: string } | null
  /** When the release server was last asked (ISO), and what went wrong then, if anything. */
  checkedAt: string | null
  checkError: string | null
  /** True when one click installs it here; otherwise `how` says what to do instead. */
  canInstall: boolean
  how: string | null
  state: 'idle' | 'downloading' | 'preparing' | 'restarting'
  /**
   * How the last update went, kept until the next one and given only while the version that told it runs. `terminal`
   * (only on a failure, and only when true): only `./install.sh --update` in a terminal gets past it here (W-15b).
   */
  last: { kind: 'updated' | 'undone' | 'failed'; version: string; at: string; message: string; terminal?: true } | null
  enabled: boolean
  /** True when a service manager starts the agent again after an update; false when the owner has to. */
  restarts: boolean
  /** Where nothing restarts the agent: the release that is in place and runs from the next start, with what to do. */
  waiting: { version: string; message: string } | null
}

/** Said wherever an update cannot end in a restart (an install made with --no-service, started with ./run.sh). */
const NO_SERVICE = 'No background service runs this agent, so nothing starts it again by itself'
const KV_NOTIFIED = 'update_notified'
const KV_LAST = 'update_last'

export class Updater {
  private readonly d: UpdaterDeps
  private available: Manifest | null = null
  private checkedAt: string | null = null
  private checkError: string | null = null
  private state: UpdateView['state'] = 'idle'
  /** The check that is asking the release server right now, and when the last one ended (ms, 0 for never). */
  private asking: Promise<UpdateView> | null = null
  private askedAt = 0
  private timer: NodeJS.Timeout | undefined
  private confirmTimer: NodeJS.Timeout | undefined
  private stopped = false

  constructor(deps: UpdaterDeps) {
    this.d = deps
  }

  private get source(): string {
    return this.d.source ?? DEFAULT_SOURCE
  }

  /**
   * How the last update went, while the version that told it is the one running (W-16): "you run 1.0.2 as before"
   * is not shown once 1.0.4 runs, after the install line was pasted again or an update from a terminal. A result
   * written before results named their version (`ran`) is shown as before.
   */
  private last(): UpdateView['last'] {
    try {
      const v = JSON.parse(this.d.kv.get(KV_LAST) ?? 'null') as (NonNullable<UpdateView['last']> & { ran?: unknown }) | null
      if (!v || typeof v.version !== 'string' || typeof v.message !== 'string' || typeof v.at !== 'string' || !['updated', 'undone', 'failed'].includes(v.kind)) return null
      if (v.ran !== undefined && v.ran !== this.d.installed) return null
      return { kind: v.kind, version: v.version, at: v.at, message: v.message, ...(v.kind === 'failed' && v.terminal === true ? { terminal: true as const } : {}) }
    } catch {
      return null
    }
  }

  private setLast(kind: NonNullable<UpdateView['last']>['kind'], version: string, message: string, terminal = false): void {
    this.d.kv.set(KV_LAST, JSON.stringify({ kind, version, at: new Date().toISOString(), message, ran: this.d.installed, ...(terminal ? { terminal: true } : {}) }))
  }

  private get restarts(): boolean {
    return this.d.supervised !== false
  }

  /**
   * Where nothing restarts the agent: the release that an update put in place, read from the disk (so it is also
   * true after `./install.sh --update` in a terminal), with the sentence for the owner.
   */
  private waiting(): UpdateView['waiting'] {
    if (this.restarts) return null
    const name = waitingRelease(this.d.layout)
    if (name === null) return null
    const version = name.replace(/^v/, '')
    return { version, message: `Version ${version} is in place and runs from the next start. ${NO_SERVICE}: ${this.byHand()}. Until then it runs ${this.d.installed}.` }
  }

  /** What starts the new version where nothing restarts the agent: the owner, with the launcher of the install. */
  private byHand(): string {
    return `stop the agent (Ctrl-C in its terminal), then run ./run.sh again in ${this.d.layout.root}`
  }

  view(): UpdateView {
    const how = selfUpdateRefusal(this.d.layout, { isServer: this.d.isServer })
    return {
      installed: this.d.installed,
      available: this.available ? { version: this.available.version, notes: this.available.notes, published: this.available.published } : null,
      checkedAt: this.checkedAt,
      checkError: this.checkError,
      canInstall: how === null,
      how,
      state: this.state,
      last: this.last(),
      enabled: this.d.enabled,
      restarts: this.restarts,
      waiting: this.waiting(),
    }
  }

  /**
   * At the end of the service's start: say how the last update went, confirm a new release once it has stayed
   * up, and begin to look for the next one.
   */
  start(): void {
    const note = startNote(this.d.layout)
    if (note.rolledBack) {
      const to = note.rolledBack.to.replace(/^v/, '')
      const message = `The update to ${to} did not start and was undone: you run ${this.d.installed} as before. Your wallet, settings and history are untouched. It is safe to try again later.`
      this.setLast('undone', to, message)
      this.d.notify(message)
    }
    if (note.updatedFrom) {
      const from = note.updatedFrom.replace(/^v/, '')
      this.confirmTimer = setTimeout(() => {
        confirmStart(this.d.layout)
        try {
          refreshLauncher(this.d.layout)
        } catch (err) {
          console.error('the launcher could not be refreshed (the one in place keeps working):', err)
        }
        const message = `Updated from ${from} to ${this.d.installed}.`
        this.setLast('updated', this.d.installed, message)
        this.d.notify(`foxleague-agent: ${message}`)
      }, this.d.confirmAfterMs ?? CONFIRM_AFTER_MS)
      this.confirmTimer.unref()
    } else {
      // No update in flight: clears the undo note that was just told and a note left by a switch that never happened.
      confirmStart(this.d.layout)
    }
    if (!this.d.enabled) return
    const again = (ms: number): void => {
      if (this.stopped) return
      this.timer = setTimeout(() => void this.check().catch(() => undefined).finally(() => again(CHECK_EVERY_MS + Math.random() * 60_000)), ms)
      this.timer.unref()
    }
    again(30_000 + Math.random() * 60_000)
  }

  stop(): void {
    this.stopped = true
    clearTimeout(this.timer)
    clearTimeout(this.confirmTimer)
  }

  /**
   * Asks the release server once. A release is offered only when it is signed and newer than the running one.
   * While a check runs, or sooner than MIN_CHECK_GAP_MS after the last one ended, it answers with that check.
   */
  async check(): Promise<UpdateView> {
    if (!this.d.enabled) return this.view()
    if (this.asking) return this.asking
    if (this.askedAt > 0 && Date.now() - this.askedAt < (this.d.checkGapMs ?? MIN_CHECK_GAP_MS)) return this.view()
    this.asking = this.ask().finally(() => {
      this.askedAt = Date.now()
      this.asking = null
    })
    return this.asking
  }

  private async ask(): Promise<UpdateView> {
    try {
      const rel = await fetchRelease(this.source, this.d.keys, { fetch: this.d.fetch })
      this.checkError = null
      this.available = isNewer(rel.manifest.version, this.d.installed) ? rel.manifest : null
      if (this.available && this.d.kv.get(KV_NOTIFIED) !== this.available.version) {
        this.d.kv.set(KV_NOTIFIED, this.available.version)
        this.d.notify(this.notice(this.available))
      }
    } catch (err) {
      // Not said on Telegram: a release server that is down or a network without a route is not the owner's problem.
      // An error that is not the updater's own goes to the log; the page says "The check failed: " before the text.
      if (!(err instanceof UpdateError)) console.error('the update check failed:', err)
      this.checkError = err instanceof UpdateError ? err.message : 'an unexpected error (see the log)'
    }
    this.checkedAt = new Date().toISOString()
    return this.view()
  }

  private notice(m: Manifest): string {
    const how = selfUpdateRefusal(this.d.layout, { isServer: this.d.isServer })
    return [
      `foxleague-agent ${m.version} is out (you run ${this.d.installed}).`,
      ...(m.notes.trim() ? [m.notes.trim()] : []),
      how !== null
        ? `To install it: ${how}.`
        : this.restarts
          ? 'To install it: send /upgrade here, or press Update now in the dashboard. The agent restarts and tells you when it is back.'
          : 'To install it: send /upgrade here, or press Update now in the dashboard. The new version then runs from the next start of the agent: nothing restarts it by itself here.',
    ].join('\n')
  }

  /**
   * The owner asked for the update. Refuses with a reason (UpdateError) or starts it and returns what to tell them;
   * the rest happens in the background and is told through notify.
   */
  async begin(by: string): Promise<string> {
    if (!this.d.enabled) throw new UpdateError('updates are switched off on this machine (AGENT_UPDATE_CHECK=0)')
    if (this.state !== 'idle') throw new UpdateError('an update is already being installed')
    // The release that runs was itself just installed and has not yet stayed up long enough to count as started
    // (versions/pending still names it): the launcher may still undo it. A new update now would take its note
    // and make an unproven release the one to go back to.
    if (startNote(this.d.layout).updatedFrom !== undefined) throw new UpdateError('the last update is still being confirmed, try again in a minute')
    // Where nothing restarts the agent, a release that is already in place is told again and nothing more is done.
    const waiting = this.waiting()
    if (waiting) return waiting.message
    const how = selfUpdateRefusal(this.d.layout, { isServer: this.d.isServer })
    // The slot is taken before the first await (UPD-A2): a second ask while the release server is asked here is
    // refused above, instead of starting a second install on the same archive. Every refusal below gives it back.
    this.state = 'downloading'
    let version: string
    try {
      if (!this.available) await this.check()
      if (!this.available) throw new UpdateError(this.checkError ? `the release server could not be asked: ${this.checkError}` : `you run ${this.d.installed}, the newest version`)
      if (how !== null) throw new UpdateError(how)
      version = this.available.version
    } catch (err) {
      this.state = 'idle'
      throw err
    }
    void this.install(version, by)
    if (!this.restarts) return `Installing ${version}. This takes a minute or two. ${NO_SERVICE}: the new version runs from the next start. Once it is in place, ${this.byHand()}.`
    return `Installing ${version}. This takes a minute or two; the agent then restarts and tells you when it is back.`
  }

  private async install(version: string, by: string): Promise<void> {
    const dir = join(this.d.dataDir, 'update')
    const archive = join(dir, archiveName(version))
    try {
      // Asked again and verified again, for exactly the version the owner saw: nothing is taken from memory.
      const rel = await fetchRelease(this.source, this.d.keys, { fetch: this.d.fetch, version })
      if (!isNewer(rel.manifest.version, this.d.installed)) throw new UpdateError('that release is not newer than the running one')
      mkdirSync(dir, { recursive: true, mode: 0o700 })
      await downloadArchive(this.source, rel.manifest, archive, { fetch: this.d.fetch })
      this.state = 'preparing'
      const name = await stage(this.d.layout, rel.manifest, archive, { run: this.d.run })
      activate(this.d.layout, name)
      if (!this.restarts) {
        // Nothing would start the agent again: it plays on with the release it runs, and its owner starts the new one.
        this.state = 'idle'
        this.d.notify(`foxleague-agent: ${this.waiting()?.message ?? `Version ${version} is in place and runs from the next start.`} (Asked by ${by}.)`)
        return
      }
      this.state = 'restarting'
      this.d.notify(`foxleague-agent: version ${version} is in place (asked by ${by}). Restarting into it now.`)
      await this.d.restart()
    } catch (err) {
      const message = `The update to ${version} was not installed: ${err instanceof UpdateError ? err.message : 'an unexpected error (see the log)'}. You run ${this.d.installed} as before.`
      if (!(err instanceof UpdateError)) console.error('update failed:', err)
      this.setLast('failed', version, message, err instanceof UpdateError && err.terminal)
      this.state = 'idle'
      this.d.notify(message)
    } finally {
      rmSync(archive, { force: true })
    }
  }
}

/**
 * The same update from a terminal (`./install.sh --update`): look, verify, download, prepare and switch. The
 * caller restarts the agent. Returns the version put in place, or null when the running one is the newest.
 */
export async function terminalUpdate(o: { layout: Layout; installed: string; keys: readonly string[]; source?: string; dataDir: string; isServer?: boolean; say: (line: string) => void; fetch?: FetchLike; run?: Runner }): Promise<string | null> {
  const how = selfUpdateRefusal(o.layout, { isServer: o.isServer })
  if (how !== null) throw new UpdateError(how)
  const source = o.source ?? DEFAULT_SOURCE
  const rel = await fetchRelease(source, o.keys, { fetch: o.fetch })
  if (!isNewer(rel.manifest.version, o.installed)) return null
  o.say(`Version ${rel.manifest.version} is out (you run ${o.installed}); its signature is good.`)
  if (rel.manifest.notes.trim()) o.say(rel.manifest.notes.trim())
  const dir = join(o.dataDir, 'update')
  const archive = join(dir, archiveName(rel.manifest.version))
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  try {
    o.say('Downloading it')
    await downloadArchive(source, rel.manifest, archive, { fetch: o.fetch })
    o.say('Preparing it next to the running version (Node.js and dependencies)')
    activate(o.layout, await stage(o.layout, rel.manifest, archive, { run: o.run }))
  } finally {
    rmSync(archive, { force: true })
  }
  return rel.manifest.version
}
