// Did a service manager start this agent? An update ends the process and counts on being started again
// (updater.ts): where nothing starts it again, the agent must not end.

import { fstatSync, readFileSync } from 'node:fs'

/** The label of the launchd job the installer writes (install.sh, PLIST_LABEL). */
const LAUNCHD_LABEL = 'ai.foxleague.agent'
/** The systemd user unit the installer writes (install.sh, SERVICE). */
const INSTALLER_UNIT = 'foxleague-agent.service'

/** Where this process's standard output and standard error go, as systemd names a stream: `device:inode`. */
function ownStreams(): string[] {
  const out: string[] = []
  for (const fd of [1, 2]) {
    try {
      const s = fstatSync(fd)
      out.push(`${s.dev}:${s.ino}`)
    } catch {
      // a closed stream is no stream
    }
  }
  return out
}

/** This process's cgroups as the kernel lists them (`/proc/self/cgroup`); null where they cannot be read. */
function ownCgroup(): string | null {
  try {
    return readFileSync('/proc/self/cgroup', 'utf8')
  } catch {
    return null
  }
}

/**
 * The systemd user units a cgroup listing names: the last part of each path that ends in .service, under a user's own
 * manager (`.../user@1000.service/[app.slice/]x.service`). The installer writes a user unit only: a system unit of the
 * same name is a unit of the owner's own (R2I-4).
 */
function unitsOf(cgroup: string): string[] {
  const units: string[] = []
  for (const line of cgroup.split('\n')) {
    const path = line.slice(line.lastIndexOf(':') + 1).trim()
    const parts = path.split('/')
    const last = parts.at(-1) ?? ''
    if (last.endsWith('.service') && parts.slice(0, -1).some(p => /^user@\d+\.service$/.test(p))) units.push(last)
  }
  return units
}

/**
 * True when a service manager started the agent and starts it again when it ends:
 *   FOXAGENT_SUPERVISED=1  the units the installer writes set it (0: the owner says that nothing restarts it);
 *   XPC_SERVICE_NAME       launchd sets it to the label of the job it started;
 *   INVOCATION_ID with JOURNAL_STREAM naming this process's own output, in the installer's own unit (its cgroup ends in
 *                          foxleague-agent.service under a user's manager, user@<uid>.service; a system unit of that
 *                          name is the owner's own, R2I-4): that unit as it was written before it said so itself, which
 *                          restarts the agent after every exit.
 * INVOCATION_ID alone proves nothing: a terminal that a user service of the desktop opened inherits it, with a
 * JOURNAL_STREAM that names that service's output and not the terminal. A unit of the owner's own proves nothing either
 * (UPD-U4): its Restart= cannot be seen from inside and systemd's default is no, so it counts only when it says
 * FOXAGENT_SUPERVISED=1, as the guides ask. Whatever is not recognised counts as started by hand: the agent then plays
 * on and tells its owner, where the other mistake would leave it stopped.
 */
export function supervised(env: NodeJS.ProcessEnv = process.env, streams: () => string[] = ownStreams, cgroup: () => string | null = ownCgroup): boolean {
  const said = env.FOXAGENT_SUPERVISED?.trim()
  if (said === '1') return true
  if (said === '0') return false
  if (env.XPC_SERVICE_NAME === LAUNCHD_LABEL) return true
  const journal = env.JOURNAL_STREAM?.trim()
  if (!(env.INVOCATION_ID && journal && streams().includes(journal))) return false
  const listed = cgroup()
  return listed !== null && unitsOf(listed).includes(INSTALLER_UNIT)
}
