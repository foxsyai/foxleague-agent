// Did a service manager start this agent? An update ends the process and counts on being started again
// (updater.ts): where nothing starts it again, the agent must not end.

import { fstatSync } from 'node:fs'

/** The label of the launchd job the installer writes (install.sh, PLIST_LABEL). */
const LAUNCHD_LABEL = 'ai.foxleague.agent'

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

/**
 * True when a service manager started the agent and starts it again when it ends:
 *   FOXAGENT_SUPERVISED=1  the units the installer writes set it (0: the owner says that nothing restarts it);
 *   XPC_SERVICE_NAME       launchd sets it to the label of the job it started;
 *   INVOCATION_ID with JOURNAL_STREAM naming this process's own output: a systemd unit written before the units
 *                          said so themselves.
 * INVOCATION_ID alone proves nothing: a terminal that a user service of the desktop opened inherits it, with a
 * JOURNAL_STREAM that names that service's output and not the terminal. Whatever is not recognised counts as
 * started by hand: the agent then plays on and tells its owner, where the other mistake would leave it stopped.
 */
export function supervised(env: NodeJS.ProcessEnv = process.env, streams: () => string[] = ownStreams): boolean {
  const said = env.FOXAGENT_SUPERVISED?.trim()
  if (said === '1') return true
  if (said === '0') return false
  if (env.XPC_SERVICE_NAME === LAUNCHD_LABEL) return true
  const journal = env.JOURNAL_STREAM?.trim()
  return Boolean(env.INVOCATION_ID && journal && streams().includes(journal))
}
