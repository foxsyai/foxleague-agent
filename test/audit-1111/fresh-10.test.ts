// FRESH-10 (fresh Ubuntu walk-through, 2026-11-11): the installer took any port from 1024 to 65535 for the
// dashboard, also one that another program on the machine already listens on. Measured under the real unit: the
// agent then ends at every start with an EADDRINUSE stack trace, systemd starts it again every 30 seconds and
// gives up after the fifth time, so the agent does not play at all. The installer waited 30 seconds and said
// "The dashboard is not answering yet" (or "Running." when the other program answers /healthz). Safe: at step 3
// a port that something else listens on is refused with a free one offered; the port this install's own running
// agent holds is still accepted (a re-run of the installer keeps it).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:net'
import { join } from 'node:path'
import { LOGIN_LINES, freshInstall, guided } from './install-helpers.ts'

async function listener(): Promise<{ port: number; server: Server }> {
  const server = createServer(s => s.destroy())
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { port: (server.address() as { port: number }).port, server }
}
/** A port nothing listens on: one that was just given out and closed again. */
async function freePort(): Promise<number> {
  const l = await listener()
  await new Promise<void>(resolve => l.server.close(() => resolve()))
  return l.port
}
const portOf = (root: string): string => /^WEB_UI_PORT="(\d+)"$/m.exec(readFileSync(join(root, '.env'), 'utf8'))?.[1] ?? ''

test('FRESH-10: a port that another program listens on is refused at step 3, and a free one is taken', { timeout: 120_000 }, async () => {
  const taken = await listener()
  const free = await freePort()
  try {
    const i = freshInstall()
    writeFileSync(join(i.root, '.env'), LOGIN_LINES, { mode: 0o600 })
    // yes, keep the login, the taken port, then a free one, no keys, no live permission.
    const r = await guided(i, ['yes', '', String(taken.port), String(free), 'n', 'n'])
    assert.equal(r.status, 0, r.out)
    assert.equal(r.unread, 0, 'the port was asked for a second time')
    assert.ok(r.out.includes(`Port ${taken.port} is already used by another program on this machine.`), r.out)
    assert.equal(portOf(i.root), String(free))
    assert.ok(r.out.includes(`http://localhost:${free}`))
  } finally {
    taken.server.close()
  }
})

test('FRESH-10: the port that this install\'s own running agent holds is kept on a re-run', { timeout: 120_000 }, async () => {
  const own = await listener()
  try {
    const i = freshInstall()
    writeFileSync(join(i.root, '.env'), `${LOGIN_LINES}WEB_UI_PORT="${own.port}"\n`, { mode: 0o600 })
    // The agent of this install runs (its process id is noted in the data folder) and listens on that port.
    mkdirSync(join(i.root, 'data'), { recursive: true, mode: 0o700 })
    writeFileSync(join(i.root, 'data', 'service.pid'), `${process.pid}\n`, { mode: 0o600 })
    // Enter at the port keeps it.
    const r = await guided(i, ['yes', '', '', 'n', 'n'])
    assert.equal(r.status, 0, r.out)
    assert.equal(r.unread, 0)
    assert.doesNotMatch(r.out, /already used by another program/)
    assert.equal(portOf(i.root), String(own.port))
  } finally {
    own.server.close()
  }
})
