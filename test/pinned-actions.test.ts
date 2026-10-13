// Whole-project review, 2026-10-13 (B5): a moving tag lets whoever controls an action's repository change the code
// that runs next to the review credentials and the App key. Every action is pinned to a commit, with its release
// in a comment.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const WORKFLOWS = join(resolve(import.meta.dirname, '..'), '.github', 'workflows')

test('B5 every action in the workflows is pinned to a commit SHA with its version in a comment', () => {
  const loose: string[] = []
  let seen = 0
  for (const file of readdirSync(WORKFLOWS).filter(f => /\.ya?ml$/.test(f))) {
    for (const line of readFileSync(join(WORKFLOWS, file), 'utf8').split('\n')) {
      const m = /^\s*-?\s*uses:\s*(\S+)(.*)$/.exec(line)
      if (!m) continue
      seen++
      if (m[1]!.startsWith('./')) continue // a local action is part of this repository
      if (!/@[0-9a-f]{40}$/.test(m[1]!) || !/^\s+# v\d+\.\d+\.\d+\s*$/.test(m[2]!)) loose.push(`${file}: ${line.trim()}`)
    }
  }
  assert.ok(seen > 0, 'no actions found')
  assert.deepEqual(loose, [], `actions not pinned to a commit:\n${loose.join('\n')}`)
})
