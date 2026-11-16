// INSTALL-10 (regression on the new scripts; the audit's proof was written against the flat install of ac8833f,
// where a cut after the rm -rf of src/ and before the copy left an install with no code). `curl … get.sh | bash`
// runs get.sh as its bytes arrive, so a download that stops part-way runs every complete line before the cut.
// Safe: get.sh cut at any byte either changes nothing or completes. Its whole body is one function called on the
// last line, so a cut script is a syntax error and nothing of it runs.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO, pack, sh, smallTree, snapshotOf, tmp } from './install-helpers.ts'

const GET = readFileSync(join(REPO, 'get.sh'))
const NEW = pack(smallTree(tmp(), '3.1.0', { 'src/service.ts': '// the new copy of 3.1.0\n' }))

/** The cut points: the end of every line, a spread of bytes inside lines and every byte of the last 80. */
function cuts(): number[] {
  const at = new Set<number>()
  for (let i = 0; i < GET.length; i++) if (GET[i] === 0x0a) at.add(i + 1)
  for (let i = 1; i < GET.length; i += 61) at.add(i)
  for (let i = Math.max(1, GET.length - 80); i < GET.length; i++) at.add(i)
  return [...at].sort((a, b) => a - b)
}

interface Case {
  name: string
  make: () => { home: string; dir: string }
  /** 'untouched', 'complete' or what is wrong. */
  state: (dir: string, before: Record<string, string>) => string
}

const CASES: Case[] = [
  {
    name: 'the same version installed again over an install',
    make: () => {
      const home = tmp('fox-home-')
      const dir = join(home, 'foxleague-agent')
      smallTree(join(dir, 'versions', 'v3.1.0'), '3.1.0', { 'src/service.ts': '// the copy that runs\n' })
      writeFileSync(join(dir, 'versions', 'active'), 'v3.1.0\n')
      writeFileSync(join(dir, '.env'), 'AGENT_MNEMONIC="the owner words"\n')
      return { home, dir }
    },
    state: (dir, before) => {
      const now = snapshotOf(dir)
      if (JSON.stringify(now) === JSON.stringify(before)) return 'untouched'
      const service = join(dir, 'versions', 'v3.1.0', 'src', 'service.ts')
      const whole = existsSync(service) && readFileSync(service, 'utf8') === '// the new copy of 3.1.0\n' && existsSync(join(dir, 'versions', 'v3.1.0', 'install.sh'))
      if (whole && now['versions/active'] === 'v3.1.0\n' && now['.env'] === before['.env'] && !Object.keys(now).some(k => k.includes('.staging-get') || k.includes('.replaced-get'))) return 'complete'
      return `versions/active names ${JSON.stringify(now['versions/active'])}; its service.ts: ${existsSync(service) ? JSON.stringify(readFileSync(service, 'utf8')) : 'missing'}`
    },
  },
  {
    name: 'an older flat install',
    make: () => {
      const home = tmp('fox-home-')
      const dir = join(home, 'foxleague-agent')
      mkdirSync(join(dir, 'src'), { recursive: true })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'foxleague-agent', version: '0.11.0' }, null, 2))
      writeFileSync(join(dir, 'src', 'service.ts'), '// the flat copy that runs\n')
      writeFileSync(join(dir, 'install.sh'), '#!/usr/bin/env bash\n')
      writeFileSync(join(dir, '.env'), 'AGENT_MNEMONIC="the owner words"\n')
      return { home, dir }
    },
    state: (dir, before) => {
      const now = snapshotOf(dir)
      if (JSON.stringify(now) === JSON.stringify(before)) return 'untouched'
      // Complete: the release in place and, since INS-U6 of 2026-11-16, the flat code still there for the old service,
      // which starts it by its path until the installer writes the new one (step 7).
      if (now['versions/active'] === 'v3.1.0\n' && now['versions/v3.1.0/src/service.ts'] === '// the new copy of 3.1.0\n' && now['.env'] === before['.env'] && now['src/service.ts'] === before['src/service.ts']) return 'complete'
      return `flat code ${'src/service.ts' in now ? 'there' : 'GONE'}; versions/active ${JSON.stringify(now['versions/active'])}`
    },
  },
]

for (const c of CASES) {
  test(`INSTALL-10: get.sh cut short at any byte either changes nothing or completes (${c.name})`, { timeout: 240_000 }, async () => {
    const points = cuts()
    const broken: string[] = []
    const seen = { untouched: 0, complete: 0 }
    const one = async (n: number): Promise<void> => {
      const { home, dir } = c.make()
      const before = snapshotOf(dir)
      // As `curl | bash` gives it: the first n bytes of the script on bash's standard input.
      await sh('', ['-s'], { HOME: home, FOXAGENT_SOURCE: NEW, FOXAGENT_NO_RUN: '1' }, { stdin: GET.subarray(0, n) })
      const state = c.state(dir, before)
      if (state === 'untouched' || state === 'complete') seen[state]++
      else broken.push(`cut after byte ${n} of ${GET.length} (line ${GET.subarray(0, n).toString('latin1').split('\n').length}): ${state}`)
    }
    // Eight at a time: each run is a few short processes.
    for (let i = 0; i < points.length; i += 8) await Promise.all(points.slice(i, i + 8).map(one))
    // One example of each way it went wrong.
    const kinds = new Map<string, string>()
    for (const b of broken) if (!kinds.has(b.replace(/^.*?\): /, ''))) kinds.set(b.replace(/^.*?\): /, ''), b)
    assert.deepEqual([...kinds.values()], [], `${broken.length} of ${points.length} cut points leave a half-done install`)
    assert.ok(seen.untouched > points.length / 2, 'most cuts run nothing at all')
    // The whole script, for the comparison: it completes.
    const { home, dir } = c.make()
    const before = snapshotOf(dir)
    const whole = await sh('', ['-s'], { HOME: home, FOXAGENT_SOURCE: NEW, FOXAGENT_NO_RUN: '1' }, { stdin: GET })
    assert.equal(whole.status, 0, whole.out)
    assert.equal(c.state(dir, before), 'complete')
  })
}

test('INSTALL-10: the body of get.sh is one function and its last line calls it and exits', () => {
  const text = GET.toString('utf8')
  const lines = text.trimEnd().split('\n')
  assert.equal(lines[lines.length - 1], 'main "$@"; exit $?')
  assert.ok(text.endsWith('main "$@"; exit $?\n'))
  const start = lines.indexOf('main() {')
  const end = lines.lastIndexOf('}')
  assert.ok(start > 0 && end === lines.length - 3, 'main() { … } closes two lines before the end')
  // Outside the function: comments, blank lines, the shell options and the call. Nothing that acts.
  const outside = [...lines.slice(0, start), ...lines.slice(end + 1, -1)].filter(l => l.trim() !== '' && !l.startsWith('#'))
  assert.deepEqual(outside, ['set -euo pipefail'])
})
