// W-9 (Windows real-PC check of 2026-11-13, high): the one-click update never installed on Ubuntu 26.04. Ubuntu's
// tar security update for CVE-2025-45582 (tar 1.35+dfsg-4ubuntu0.2, June 2026) resolves every path it unpacks with
// openat2(RESOLVE_BENEATH). The agent's systemd user unit had RestrictSUIDSGID=true, whose seccomp filter answers
// openat2 with ENOSYS because it cannot look inside the call's arguments. The 24.04 build of tar then falls back to
// openat; the 26.04 build does not, and `tar -xzf` inside the service ended with "Cannot mkdir: Function not
// implemented" (status 2). The same tar in a terminal unpacks the release. Each test here failed before its fix.
// The record is the section "Windows real-PC check (2026-11-13)" of docs/SECURITY-REVIEW.md.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { REPO } from '../update-fixtures.ts'

const read = (f: string): string => readFileSync(join(REPO, f), 'utf8')

test('W-9 the install replay runs on Ubuntu 26.04 too (FRESH_UBUNTU=26.04), where the user unit meets the tar that needs openat2', () => {
  const file = join(REPO, 'scripts/release/fresh-install-check.sh')
  const script = read('scripts/release/fresh-install-check.sh')
  assert.equal(spawnSync('bash', ['-n', file], { encoding: 'utf8' }).status, 0, 'the script parses')
  assert.match(script, /^UBUNTU=\$\{FRESH_UBUNTU:-24\.04\}$/m, 'the release to replay on is a switch, 24.04 without it')
  assert.match(script, /^case "\$UBUNTU" in 24\.04 \| 26\.04\) ;; \*\) echo "FRESH_UBUNTU must be 24\.04 or 26\.04"; exit 2 ;; esac$/m, 'only the two releases it was tried on')
  assert.match(script, /^IMAGE=fox-fresh-ubuntu:\$UBUNTU$/m)
  // The image is built FROM that release, and the first step names it.
  assert.match(script, /printf 'FROM ubuntu:%s\\n' "\$UBUNTU"/)
  assert.doesNotMatch(script, /^FROM ubuntu:24\.04$/m, 'no release written into the Dockerfile')
  assert.match(script, /say "1\. A fresh Ubuntu \$UBUNTU with systemd, no curl, no Node\.js"/)
  assert.match(script, /^#\s+FRESH_UBUNTU=26\.04 scripts\/release\/fresh-install-check\.sh/m, 'the head of the script says how')
})
