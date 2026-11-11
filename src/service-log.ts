// The service's own output file on macOS. The launchd agent that the installer writes sends the service's output
// to <data>/service.log and nothing else ever cuts that file (on Linux the output goes to the journal, which
// keeps itself bounded, and the file does not exist). The service keeps it bounded itself: when it has grown past
// 5 MB only its last 1 MB stays. The file is cut in place and never renamed, because launchd holds it open for
// appending for as long as the agent is loaded: a renamed file would go on growing under its new name.

import { closeSync, fstatSync, ftruncateSync, openSync, readSync, writeSync } from 'node:fs'
import { join } from 'node:path'

export const SERVICE_LOG_MAX_BYTES = 5 * 1024 * 1024
export const SERVICE_LOG_KEEP_BYTES = 1024 * 1024
const LOOK_EVERY_MS = 60 * 60_000

/**
 * Cuts the log at `path` to its last lines when it is over the limit. Returns the bytes it removed, 0 when there
 * was nothing to do. Never throws and never creates the file: a log must not stop the service.
 */
export function boundServiceLog(path: string, o: { maxBytes?: number; keepBytes?: number } = {}): number {
  const max = o.maxBytes ?? SERVICE_LOG_MAX_BYTES
  const keep = Math.min(o.keepBytes ?? SERVICE_LOG_KEEP_BYTES, max)
  let fd: number | undefined
  try {
    fd = openSync(path, 'r+')
    const st = fstatSync(fd)
    if (!st.isFile() || st.size <= max) return 0
    const tail = Buffer.alloc(keep)
    const n = readSync(fd, tail, 0, keep, st.size - keep)
    // Whole lines only: what is kept starts after the first line end (one long line is kept as it is).
    const kept = tail.subarray(tail.subarray(0, n).indexOf(0x0a) + 1, n)
    const limit = max >= 1024 * 1024 ? `${Math.round(max / (1024 * 1024))} MB` : `${max} bytes`
    const note = Buffer.from(`[foxleague-agent] this log grew past ${limit}: only its last lines were kept (${new Date().toISOString()})\n`)
    // In place: whoever holds the file open for appending (launchd, for this very process) goes on at its new end.
    ftruncateSync(fd, 0)
    writeSync(fd, note, 0, note.length, 0)
    writeSync(fd, kept, 0, kept.length, note.length)
    return Math.max(0, st.size - note.length - kept.length)
  } catch {
    return 0
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // nothing to do about a log that cannot be closed
      }
    }
  }
}

/** At the service's start: bound <dataDir>/service.log now and look again every hour. The timer does not keep the process alive. */
export function keepServiceLogBounded(dataDir: string): NodeJS.Timeout {
  const path = join(dataDir, 'service.log')
  boundServiceLog(path)
  const timer = setInterval(() => boundServiceLog(path), LOOK_EVERY_MS)
  timer.unref()
  return timer
}
