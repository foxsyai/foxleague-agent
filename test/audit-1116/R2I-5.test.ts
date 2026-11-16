// R2I-5 (INS-U5, the forms the installer does not read): the installer decides with its own get_env, which sees only
// a line that starts with `WEB_UI_INSECURE_COOKIE=` and takes everything after the `=` but one pair of double quotes.
// The agent reads .env with Node.js (process.loadEnvFile): an `export` in front, spaces around the name, single quotes,
// a space or a `# note` after the value are all the same setting to it, and of two lines the last one wins.
// (install.sh knows this of AGENT_LIVE_ENABLED: "A line in another form (export, spaces around the name) is read by the
// agent and not by this script", live_default.)
//   a. `export WEB_UI_INSECURE_COOKIE=0` (https of the owner's own in front): get_env finds nothing, the installer
//      appends WEB_UI_INSECURE_COOKIE="1" and the agent then reads 1. The owner's secure cookie is a plain one again,
//      without a word: the defect INS-U5 fixed, in another spelling.
//   b. `WEB_UI_INSECURE_COOKIE=1 # plain http, this PC only` (or `='1'`, or a space after the 1): the agent reads 1 and
//      sends the plain cookie, and the screen says "kept as you set it (not 1): the login cookie is sent over https
//      only, so log in at your https address." An owner on http://localhost is sent to an https address there is not.
// Right: what the installer keeps, writes and says about the cookie follows the value the agent reads.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { LOGIN_LINES, freshInstall, guided } from '../audit-1111/install-helpers.ts'

/** WEB_UI_INSECURE_COOKIE as the agent reads it from an env file (src/config.ts: process.loadEnvFile), nothing of it set before. */
function agentReads(envFile: string): string {
  const { WEB_UI_INSECURE_COOKIE: _, ...clean } = process.env
  return execFileSync(process.execPath, ['-e', 'process.loadEnvFile(process.argv[1]); process.stdout.write(String(process.env.WEB_UI_INSECURE_COOKIE))', envFile], { env: clean, encoding: 'utf8' })
}

async function installed(): Promise<{ i: ReturnType<typeof freshInstall>; env: string }> {
  const i = freshInstall()
  const env = join(i.root, '.env')
  writeFileSync(env, LOGIN_LINES, { mode: 0o600 })
  const first = await guided(i, ['yes', '', '18997', 'n', 'n'])
  assert.equal(first.status, 0, first.out.slice(-600))
  assert.equal(agentReads(env), '1', 'a new install gets the plain cookie')
  return { i, env }
}

test('R2I-5a: a secure cookie the owner set as "export WEB_UI_INSECURE_COOKIE=0" is still what the agent reads after the installer ran again', { timeout: 240_000 }, async () => {
  const { i, env } = await installed()
  writeFileSync(env, readFileSync(env, 'utf8').replace('WEB_UI_INSECURE_COOKIE="1"', 'export WEB_UI_INSECURE_COOKIE=0'), { mode: 0o600 })
  assert.equal(agentReads(env), '0', 'the agent reads the owner\'s line: the cookie is sent over https only')
  const again = await guided(i, ['', '18997', 'n', ''])
  assert.equal(again.status, 0, again.out.slice(-600))
  assert.equal(agentReads(env), '0', `the installer turned the owner's secure cookie into a plain one without a word:\n${readFileSync(env, 'utf8').split('\n').filter(l => l.includes('INSECURE_COOKIE')).join('\n')}`)
})

test('R2I-5b: a plain cookie written as "WEB_UI_INSECURE_COOKIE=1 # note" is not said to be https only', { timeout: 240_000 }, async () => {
  const { i, env } = await installed()
  writeFileSync(env, readFileSync(env, 'utf8').replace('WEB_UI_INSECURE_COOKIE="1"', 'WEB_UI_INSECURE_COOKIE=1 # plain http, this PC only'), { mode: 0o600 })
  assert.equal(agentReads(env), '1', 'the agent reads 1: the cookie is plain')
  const again = await guided(i, ['', '18997', 'n', ''])
  assert.equal(again.status, 0, again.out.slice(-600))
  assert.equal(agentReads(env), '1')
  assert.doesNotMatch(again.out, /not 1\): the login cookie is sent over https only/, `the screen says https only while the agent reads 1 and sends the plain cookie:\n${again.out.slice(again.out.indexOf('3/7'), again.out.indexOf('4/7'))}`)
})
