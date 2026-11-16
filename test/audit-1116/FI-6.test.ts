// FI-6 (R2I-6, the choice the record names: "a setup that passes the words only with -e and has none in .env can no
// longer use cli.sh for wallet commands; run.sh still works there"): what cli.sh SAYS there undoes "run.sh still
// works there". cli.sh now drops the environment's AGENT_MNEMONIC without a word, so in that setup (a container or a
// unit of the owner's own that gives the words in its environment, .env without them) every wallet command answers
//   No AGENT_MNEMONIC in <folder>/.env: run `./cli.sh setup` first.
// The owner does what the screen says. `./cli.sh setup` writes NEW recovery words into .env (it prints "New recovery
// words written" and the address of another wallet). From then on run.sh, which until then took the words given,
// compares them with .env's, finds them different and refuses every start:
//   AGENT_MNEMONIC is set in this terminal and its recovery words are not the ones in <folder>/.env ... Remove it
// A container that restarts stays down (with its paid seats unplayed), and the remedy the second message names
// ("unset AGENT_MNEMONIC") would start the agent on the new, empty wallet (check-words then refuses that too).
// Right: in a setup where the words are given in the environment and .env has none, following what cli.sh itself
// tells the owner to type never stops run.sh from starting the agent with the wallet it ran with.
// (Any of these makes it pass: cli.sh keeps the words given when .env has none, as run.sh does; or it says that the
// words are in the environment and names no setup; or setup refuses to make new words while words are given.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { running, sh, stubs, tmp } from '../audit-1111/install-helpers.ts'
import { Mnemonic } from '@multiversx/sdk-core'

test('FI-6: with the words given in the environment and none in .env, doing what cli.sh says does not stop run.sh from starting the agent', { timeout: 120_000 }, async () => {
  const s = stubs()
  const i = running(s)
  // A throwaway wallet made for this test only.
  const given = Mnemonic.generate().toString()
  writeFileSync(join(i.root, '.env'), 'WEB_UI_PORT="18870"\n', { mode: 0o600 })
  const env = { HOME: i.home, PATH: `${s.dir}:${process.env.PATH}`, AGENT_MNEMONIC: given, FOXAGENT_SUPERVISED: '1' }
  // The agent's Node.js for run.sh's last line: it notes that the agent was started. cli.sh uses the real one.
  const ran = join(tmp('fox-ran-'), 'ran')
  const wrapper = join(tmp('fox-node-'), 'node')
  writeFileSync(wrapper, ['#!/usr/bin/env bash', `for a in "$@"; do case "$a" in */src/service.ts) echo started >> ${JSON.stringify(ran)}; exit 0 ;; esac; done`, `exec ${JSON.stringify(process.execPath)} "$@"`, ''].join('\n'), { mode: 0o755 })
  writeFileSync(join(i.root, '.node-path'), `${wrapper}\n`)
  const starts = (): number => (existsSync(ran) ? readFileSync(ran, 'utf8').trim().split('\n').length : 0)

  // The setup as the record describes it: run.sh takes the words given.
  const first = await sh(join(i.root, 'run.sh'), [], env, { cwd: i.root })
  assert.equal(first.status, 0, first.out)
  assert.equal(starts(), 1, 'run.sh starts the agent with the words given')

  // The owner asks cli.sh for the agent's address and does what its answer says to type.
  const asked = await sh(join(i.root, 'cli.sh'), ['address', '1'], env, { cwd: i.root })
  const told = /run `\.\/cli\.sh (setup)` first/.exec(asked.out)
  let did = ''
  if (told) did = (await sh(join(i.root, 'cli.sh'), [told[1]!], env, { cwd: i.root })).out

  // The container restarts.
  const again = await sh(join(i.root, 'run.sh'), [], env, { cwd: i.root })
  assert.equal(starts(), 2, `after doing what cli.sh said, run.sh no longer starts the agent.\ncli.sh address 1: ${asked.out.trim()}\n${told ? `cli.sh ${told[1]}: ${did.replace(/erd1[0-9a-z]+/g, 'erd1...').trim()}\n` : ''}run.sh: ${again.out.trim()}`)
  assert.equal(again.status, 0, again.out)
})
