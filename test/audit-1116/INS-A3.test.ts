// INS-A3: a .env with Windows line ends (CR LF). Node.js reads it as the agent does (process.loadEnvFile drops the
// CR): AGENT_LIVE_ENABLED="1" is 1 and WEB_UI_PORT="8870" is 8870. The installer's get_env strips the closing quote
// only at the very end of the line, where the CR now stands, so it reads 1"<CR> and 8870"<CR>:
//  - at "Dashboard port" Enter (keep my port) is answered with "Use a number from 1024 to 65535." every time;
//  - at "Allow this machine to sign real transactions" the default is n although .env says 1, and Enter writes
//    AGENT_LIVE_ENABLED="0": a LIVE install stops signing at the restart of step 7.
// The guides promise the opposite ("each with your earlier answer as the default, so pressing Enter keeps things
// as they are"; "Pressing Enter at the live permission keeps it as .env has it"), and on Windows "paste the line
// again" is the remedy of six rows of "If it gets stuck". The guides also send a Windows owner into .env
// (AGENT_LIVE_ENABLED, WEB_UI_PORT, BINANCE_ACCOUNT_TYPE, AGENT_UPDATE_CHECK) and give its folder for Windows
// Explorer (\\wsl$\Ubuntu\home\...\foxleague-agent); set_env itself already expects "a line appended from Windows".
// Safe: the installer reads a value the way the agent does, whatever the line end.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOGIN_LINES, freshInstall, guided } from '../audit-1111/install-helpers.ts'

/** What the agent reads from an env file: Node's own reader, in a process with no environment of its own. */
function agentReads(file: string, key: string): string {
  return execFileSync(process.execPath, ['-e', `process.loadEnvFile(${JSON.stringify(file)}); process.stdout.write(String(process.env[${JSON.stringify(key)}]))`], { env: {}, encoding: 'utf8' })
}

test('INS-A3: with Windows line ends in .env, Enter at the port and at the live permission keeps what the agent reads', { timeout: 240_000 }, async () => {
  const i = freshInstall()
  const env = join(i.root, '.env')
  writeFileSync(env, LOGIN_LINES, { mode: 0o600 })
  // A first install that allows live signing (the typed yes, login kept, the port, no keys, y at the live permission).
  const first = await guided(i, ['yes', '', '18997', 'n', 'y'])
  assert.equal(first.status, 0, first.out)
  assert.equal(agentReads(env, 'AGENT_LIVE_ENABLED'), '1')
  // The file is saved once by an editor on Windows that ends lines with CR LF. The agent reads the same values.
  writeFileSync(env, readFileSync(env, 'utf8').replace(/\n/g, '\r\n'), { mode: 0o600 })
  assert.equal(agentReads(env, 'AGENT_LIVE_ENABLED'), '1', 'the agent still reads 1')
  assert.equal(agentReads(env, 'WEB_UI_PORT'), '18997', 'the agent still reads the port')

  // The installer again, Enter everywhere: login kept, port kept, no keys, live permission as it is.
  const again = await guided(i, ['', '', 'n', ''])
  assert.doesNotMatch(again.out, /Use a number from 1024 to 65535/, `Enter at the port did not keep the port the agent uses:\n${again.out.slice(again.out.indexOf('3/7'), again.out.indexOf('3/7') + 400)}`)
  assert.equal(again.status, 0, again.out.slice(-600))
  assert.equal(agentReads(env, 'WEB_UI_PORT'), '18997')
  assert.equal(agentReads(env, 'AGENT_LIVE_ENABLED'), '1', 'Enter at the live permission keeps it as .env has it')
})

test('INS-A3: with the port typed, Enter at the live permission still keeps the 1 that the agent reads', { timeout: 240_000 }, async () => {
  const i = freshInstall()
  const env = join(i.root, '.env')
  writeFileSync(env, LOGIN_LINES, { mode: 0o600 })
  assert.equal((await guided(i, ['yes', '', '18997', 'n', 'y'])).status, 0)
  writeFileSync(env, readFileSync(env, 'utf8').replace(/\n/g, '\r\n'), { mode: 0o600 })
  const again = await guided(i, ['', '18997', 'n', ''])
  assert.equal(again.status, 0, again.out.slice(-600))
  assert.doesNotMatch(again.out, /Live signing stays off/, 'the installer turned live signing off at an Enter')
  assert.equal(agentReads(env, 'AGENT_LIVE_ENABLED'), '1', 'Enter at the live permission keeps it as .env has it')
})
