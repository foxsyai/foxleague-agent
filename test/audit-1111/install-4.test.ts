// INSTALL-4 (medium): the installer offered "n" at "Allow this machine to sign real transactions once you press
// Go LIVE?" only when .env said exactly AGENT_LIVE_ENABLED=0. Every other way of having it off (the line commented
// out, removed, false, off, no) was offered as "y": an owner who had stopped real spending through .env and ran
// the installer again with Enter had signing back on, while the platform mode in the database was still LIVE.
// Safe: Enter turns it on only when .env already allows it (1 or true, what the agent itself accepts) or on a
// first install (AGENT_LIVE_ENABLED nowhere in .env and no database yet).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { liveSigningAllowed } from '../../src/executor/executor.ts'
import { LOGIN_LINES, REPO, freshInstall, guided, sh, shellFunction, tmp } from './install-helpers.ts'

/** What Enter means at the live question, from install.sh's own functions, for a .env and a data folder. */
async function offered(envText: string | null, database: boolean): Promise<string> {
  const root = tmp('fox-root-')
  if (envText !== null) writeFileSync(join(root, '.env'), envText)
  mkdirSync(join(root, 'data'))
  if (database) writeFileSync(join(root, 'data', 'agent.db'), 'a database')
  const script = join(tmp(), 'live.sh')
  const fns = ['say', 'info', 'die', 'get_env', 'first_install', 'live_default'].map(n => shellFunction(join(REPO, 'install.sh'), n)).join('\n')
  writeFileSync(script, `set -euo pipefail\nROOT=${JSON.stringify(root)}\nENV_FILE="$ROOT/.env"\nDATA_DIR="$ROOT/data"\n${fns}\nFIRST_INSTALL=$(first_install)\nlive_default\n`)
  const r = await sh(script, [], {})
  assert.equal(r.status, 0, r.out)
  return r.out.trim()
}

/** What the agent itself reads from such a .env: may this machine sign? */
function agentAllows(envText: string): boolean {
  const file = join(tmp(), '.env')
  writeFileSync(file, envText)
  const before = process.env.AGENT_LIVE_ENABLED
  delete process.env.AGENT_LIVE_ENABLED
  try {
    process.loadEnvFile(file)
    return liveSigningAllowed()
  } finally {
    if (before === undefined) delete process.env.AGENT_LIVE_ENABLED
    else process.env.AGENT_LIVE_ENABLED = before
  }
}

test('INSTALL-4: Enter at the live question keeps signing off in every state where it is off', async () => {
  const off = ['# AGENT_LIVE_ENABLED=1', '', 'AGENT_LIVE_ENABLED=false', 'AGENT_LIVE_ENABLED=off', 'AGENT_LIVE_ENABLED=no', 'AGENT_LIVE_ENABLED=0', 'AGENT_LIVE_ENABLED="0"', 'AGENT_LIVE_ENABLED=', 'AGENT_LIVE_ENABLED=yes', '#AGENT_LIVE_ENABLED=true']
  for (const line of off) {
    const env = `${LOGIN_LINES}${line}\n`
    assert.equal(agentAllows(env), false, `the agent itself reads "${line}" as off`)
    assert.equal(await offered(env, true), 'n', `"${line}" with a database: Enter means no`)
  }
  // Without a database too, as soon as the file names the setting at all (commented out, or switched off).
  for (const line of off.filter(l => l !== '')) assert.equal(await offered(`${LOGIN_LINES}${line}\n`, false), 'n', `"${line}" without a database: Enter means no`)
})

test('INSTALL-4: Enter keeps signing on only where .env allows it, and offers it on a first install', async () => {
  for (const line of ['AGENT_LIVE_ENABLED=1', 'AGENT_LIVE_ENABLED="1"', 'AGENT_LIVE_ENABLED=true', 'AGENT_LIVE_ENABLED="TRUE"']) {
    const env = `${LOGIN_LINES}${line}\n`
    assert.equal(agentAllows(env), true, `the agent itself reads "${line}" as on`)
    assert.equal(await offered(env, true), 'y', `"${line}": Enter keeps it on`)
  }
  assert.equal(await offered(LOGIN_LINES, false), 'y', 'a first install: no line in .env and no database')
  assert.equal(await offered(null, false), 'y', 'a first install: no .env at all')
  assert.equal(await offered(LOGIN_LINES, true), 'n', 'the line was removed from an install that has a database')
  assert.equal(await offered(null, true), 'n', '.env is gone but the database is there')
})

test('INSTALL-4: the installer run again with Enter leaves a machine that was switched off, off', { timeout: 180_000 }, async () => {
  const i = freshInstall()
  const env = join(i.root, '.env')
  writeFileSync(env, LOGIN_LINES, { mode: 0o600 })
  // A first install, every question answered with Enter but the keys: the machine may sign once Go LIVE is pressed.
  const first = await guided(i, ['yes', '', '', 'n', ''])
  assert.equal(first.status, 0, first.out)
  assert.match(readFileSync(env, 'utf8'), /^AGENT_LIVE_ENABLED="1"$/m, 'a first install offers yes')
  // The owner goes LIVE (the mode lives in the database), later stops real spending by hand in .env.
  const live = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', join(i.code, 'src', 'cli.ts'), 'mode', 'live'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', AGENT_ENV_FILE: env, AGENT_DATA_DIR: join(i.root, 'data') } })
  assert.match(live, /mode LIVE/)
  const setLine = (line: string): void => writeFileSync(env, readFileSync(env, 'utf8').replace(/^#? ?AGENT_LIVE_ENABLED=.*\n/gm, '') + (line ? `${line}\n` : ''))
  for (const stopped of ['# AGENT_LIVE_ENABLED=1', 'AGENT_LIVE_ENABLED=false', '']) {
    setLine(stopped)
    assert.equal(agentAllows(readFileSync(env, 'utf8')), false)
    const again = await guided(i, ['', '', 'n', ''])
    assert.equal(again.status, 0, again.out)
    const text = readFileSync(env, 'utf8')
    assert.equal(agentAllows(text), false, `after "${stopped}" and Enter the machine still may not sign`)
    assert.match(text, /^AGENT_LIVE_ENABLED="0"$/m)
    assert.match(again.out, /Live signing stays off\./)
  }
  // And an owner who allows it keeps it with Enter.
  setLine('AGENT_LIVE_ENABLED=true')
  const kept = await guided(i, ['', '', 'n', ''])
  assert.equal(kept.status, 0, kept.out)
  assert.equal(agentAllows(readFileSync(env, 'utf8')), true)
})
