// R2I-4 (UPD-U4, the half that is left): supervised() takes any cgroup whose last part is foxleague-agent.service for
// "the installer's own unit". The installer writes a USER unit only (~/.config/systemd/user/foxleague-agent.service),
// so the kernel lists it under the user's manager: .../user@<uid>.service/[app.slice/]foxleague-agent.service. A SYSTEM
// unit of that name (/system.slice/foxleague-agent.service) is never the installer's: it is a unit of the owner's own,
// and foxleague-agent.service is the name an owner gives it first (the repository's own server unit,
// deploy/foxleague-agent.service, has it). The guides and .env.example say of such a unit: "Without that line a
// service of your own counts as started by hand, whatever it says about restarts". With an install made with
// --no-service, a system unit of that name without Restart= (systemd's default is no) and without
// FOXAGENT_SUPERVISED=1, Update now and /upgrade still end the agent with exit code 75 and nothing starts it again:
// the case UPD-U4 was fixed for, one name away.
// Right: only a unit under the user's own manager counts as the installer's; a system unit of any name counts as
// started by hand unless it says FOXAGENT_SUPERVISED=1.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { supervised } from '../../src/update/supervised.ts'

const TREE = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '')
const journal = { INVOCATION_ID: '3f1c0a9d2b7e4c51a8e6f0b2d4c6e8a1', JOURNAL_STREAM: '8:41235' }
const ownStreams = (): string[] => ['8:41235', '8:41235']
const flat = (f: string): string => readFileSync(`${TREE}/${f}`, 'utf8').replace(/\s+/g, ' ')

test('R2I-4: a system unit of the owner\'s own named foxleague-agent.service counts as started by hand, as the guides say', () => {
  // What the owner is told.
  assert.match(flat('site/src/content/docs/help/update.md'), /Without that line a service of your own counts as started by hand, whatever it says about restarts/)
  assert.match(flat('.env.example'), /say so with 1: without it such a unit counts as started by hand/)
  // The installer's unit is a user unit: this is where the kernel lists it (cgroup v2, then v1).
  assert.equal(supervised(journal, ownStreams, () => '0::/user.slice/user-1000.slice/user@1000.service/app.slice/foxleague-agent.service\n'), true)
  assert.equal(supervised(journal, ownStreams, () => '1:name=systemd:/user.slice/user-1000.slice/user@1000.service/foxleague-agent.service\n'), true)
  // A system unit is never the installer's, whatever its name.
  assert.equal(supervised(journal, ownStreams, () => '0::/system.slice/foxleague-agent.service\n'), false, 'a system unit of the owner\'s own (Restart= unknown, systemd\'s default is no) was taken for the installer\'s unit: Update now ends the agent with 75 and nothing starts it again')
  assert.equal(supervised(journal, ownStreams, () => '12:pids:/system.slice/foxleague-agent.service\n1:name=systemd:/system.slice/foxleague-agent.service\n0::/system.slice/foxleague-agent.service\n'), false)
})
