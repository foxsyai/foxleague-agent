// UPD-U4 (unproven item 4 of the UPDATER review of 16 Nov 2026, section 4): supervised() answers true for ANY systemd
// unit whose output is the journal (INVOCATION_ID with a JOURNAL_STREAM that names the agent's own output). That rule
// is there for the installer's own unit as it was written before it said FOXAGENT_SUPERVISED=1 (it restarts the agent
// after every exit). A unit of the owner's own, made for an install with --no-service, has no Restart= unless the
// owner wrote one (systemd's default is Restart=no), and the guides and .env.example tell such an owner that only
// FOXAGENT_SUPERVISED=1 makes an update end the agent. With the rule as it was, Update now and /upgrade ended the
// agent with exit code 75 and nothing started it again: the agent stayed down, its paid seats unplayed.
// Right: only the installer's unit (foxleague-agent.service, read from the agent's own cgroup) counts by that rule; any
// other unit counts as started by hand (the agent plays on and its owner is told) unless it says
// FOXAGENT_SUPERVISED=1, as the guides ask.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { supervised } from '../../src/update/supervised.ts'

const journal = { INVOCATION_ID: '3f1c0a9d2b7e4c51a8e6f0b2d4c6e8a1', JOURNAL_STREAM: '8:41235' }
const ownStreams = (): string[] => ['8:41235', '8:41235']
const cgroup = (unit: string) => (): string => `0::/user.slice/user-1000.slice/user@1000.service/app.slice/${unit}\n`

test('UPD-U4: a systemd unit of the owner\'s own that does not say FOXAGENT_SUPERVISED=1 counts as started by hand', () => {
  assert.equal(supervised(journal, ownStreams, cgroup('my-fox.service')), false, 'an owner\'s unit (Restart= unknown, systemd\'s default is no) was taken for one that restarts the agent')
  // A system unit of the owner's own (cgroup v1 lines, as an older systemd writes them).
  assert.equal(supervised(journal, ownStreams, () => '12:pids:/system.slice/fox.service\n1:name=systemd:/system.slice/fox.service\n0::/system.slice/fox.service\n'), false)
  // A cgroup that cannot be read: unknown is not supervised.
  assert.equal(supervised(journal, ownStreams, () => null), false)
})

test('UPD-U4: the installer\'s own unit, also one written before it said FOXAGENT_SUPERVISED=1, still counts as supervised', () => {
  assert.equal(supervised(journal, ownStreams, cgroup('foxleague-agent.service')), true)
  assert.equal(supervised(journal, ownStreams, () => '1:name=systemd:/user.slice/user-1000.slice/user@1000.service/foxleague-agent.service\n'), true)
  // What the owner says wins either way, and launchd's job is known by its label.
  assert.equal(supervised({ ...journal, FOXAGENT_SUPERVISED: '1' }, ownStreams, cgroup('my-fox.service')), true)
  assert.equal(supervised({ ...journal, FOXAGENT_SUPERVISED: '0' }, ownStreams, cgroup('foxleague-agent.service')), false)
  assert.equal(supervised({ XPC_SERVICE_NAME: 'ai.foxleague.agent' }, () => [], () => null), true)
  // A terminal of the desktop inherits INVOCATION_ID with another stream: never supervised.
  assert.equal(supervised(journal, () => ['136:7'], cgroup('foxleague-agent.service')), false)
})
