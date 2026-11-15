// W-10 (Windows real-PC check of 2026-11-13, low): when the update could not unpack its archive, the agent's log said
// only "the archive could not be unpacked". What tar said (W-9: "Cannot mkdir: Function not implemented") was found
// only by running tar by hand. Its first lines name paths inside our own signed archive and the reason. Safe: the
// first lines of tar's errors go to the log and its first line into the message. The test failed before the fix.
import { mock, test } from 'node:test'
import assert from 'node:assert/strict'
import { childEnv, detectLayout, stage } from '../../src/update/install.ts'
import { buildRelease, codeTree, managedInstall, testKey, tmp } from '../update-fixtures.ts'
import { failingTar } from './helpers.ts'

test('W-10 an archive that cannot be unpacked: the first lines of what tar said go to the log, its first line into the message', async () => {
  const tar = failingTar('/usr/bin/tar: foxleague-agent-v1.2.0/src/service.ts: Cannot write: No space left on device')
  const inst = managedInstall('1.1.0')
  const built = buildRelease(tmp(), codeTree(tmp(), '1.2.0'), '1.2.0', testKey().privatePem)
  const env = childEnv(inst.root, { PATH: `${tar.dir}:${process.env.PATH}`, HOME: process.env.HOME })
  const logged: string[] = []
  const log = mock.method(console, 'error', (...a: unknown[]) => void logged.push(a.map(String).join(' ')))
  try {
    await assert.rejects(stage(detectLayout(inst.code), built.manifest, built.archive, { env }), (err: Error) => {
      assert.equal(err.message, 'the archive could not be unpacked (tar: foxleague-agent-v1.2.0/src/service.ts: Cannot write: No space left on device)')
      return true
    })
  } finally {
    log.mock.restore()
  }
  const said = logged.join('\n')
  assert.match(said, /the update's archive could not be unpacked; tar said:/)
  assert.match(said, /Cannot write: No space left on device/, 'the first line, which a tail of the output would have lost')
  assert.match(said, /src\/f1\.ts: Cannot open/, 'and the lines after it')
  assert.ok(said.split('\n').length <= 12, `a few lines, not all ${said.split('\n').length}`)
})
