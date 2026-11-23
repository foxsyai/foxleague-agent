// ISSUE-1 (the owner, launch day 23 Nov 2026): the launch posts send people to GitHub's issues, which are public. A
// report form must ask for what helps (the version, the system, what happened) and warn, before anything is typed,
// never to paste recovery words, keys, key files, the .env or a password. A security hole goes to a private report
// (SECURITY.md), never to a public issue. The README and the site's FAQ say where each kind of message goes.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')
const read = (path: string): string => {
  assert.ok(existsSync(join(ROOT, path)), `${path} exists`)
  return readFileSync(join(ROOT, path), 'utf8')
}
const FORMS = '.github/ISSUE_TEMPLATE'
const ISSUES = 'https://github.com/foxsyai/foxleague-agent/issues'
const PRIVATE_REPORT = 'https://github.com/foxsyai/foxleague-agent/security/advisories/new'
const TELEGRAM = 'https://t.me/foxsyai'
/** The warning every public form carries: each kind of secret named. */
const SECRETS = [/recovery words/i, /private key|keys/i, /PEM/, /keystore/i, /\.env/, /password/i]

test('ISSUE-1 the problem form asks for the version, the system and what happened; it warns before anything is typed', () => {
  const form = read(`${FORMS}/problem.yml`)
  assert.match(form, /^name: Report a problem$/m)
  assert.match(form, /^labels: \["bug"\]$/m, 'a label the repository has')
  const body = form.slice(form.indexOf('body:'))
  const first = body.indexOf('type: markdown'), firstField = body.search(/type: (input|textarea|dropdown)/)
  assert.ok(first >= 0 && first < firstField, 'the warning comes before the first field')
  const warning = body.slice(first, firstField)
  for (const s of SECRETS) assert.match(warning, s, `the warning names ${s}`)
  assert.match(warning, /public/i)
  assert.ok(warning.includes('SECURITY.md'), 'a security hole is sent to the private report')
  for (const id of ['version', 'system', 'what']) {
    assert.match(body, new RegExp(`id: ${id}\\n(?:.*\\n)*?\\s+validations:\\n\\s+required: true`), `${id} is required`)
  }
  assert.doesNotMatch(body, /label: .*(words|key|password)/i, 'no field asks for a secret')
})

test('ISSUE-1 the idea form carries the same warning and a label the repository has', () => {
  const form = read(`${FORMS}/idea.yml`)
  assert.match(form, /^name: Suggest an idea$/m)
  assert.match(form, /^labels: \["enhancement"\]$/m)
  for (const s of SECRETS) assert.match(form, s, `the warning names ${s}`)
})

test('ISSUE-1 no blank issue: the chooser offers the two forms, the Telegram community and the private security report', () => {
  const config = read(`${FORMS}/config.yml`)
  assert.match(config, /^blank_issues_enabled: false$/m)
  assert.ok(config.includes(TELEGRAM), 'the community')
  assert.ok(config.includes(PRIVATE_REPORT), 'the private security report')
})

test('ISSUE-1 SECURITY.md sends a security hole to the private report and never to a public issue', () => {
  const policy = read('SECURITY.md')
  assert.ok(policy.includes(PRIVATE_REPORT))
  assert.match(policy, /not open a public issue/i)
  assert.match(policy, /newest release/i, 'which version gets the fix')
  for (const s of [/recovery words/i, /keys/i, /\.env/]) assert.match(policy, s)
})

test('ISSUE-1 the README and the site FAQ say where a problem, an idea, a question and a security hole go', () => {
  for (const [path, text] of [['README.md', read('README.md')], ['site FAQ', read('site/src/content/docs/help/faq.md')]] as const) {
    assert.ok(text.includes(`${ISSUES}/new/choose`), `${path}: the issue forms`)
    assert.ok(text.includes(TELEGRAM), `${path}: the community`)
    assert.match(text, /SECURITY\.md/, `${path}: the security policy`)
    assert.match(text, /never paste/i, `${path}: the warning`)
  }
  // Where someone with a problem looks first.
  const stuck = read('site/src/content/docs/help/troubleshooting.md')
  assert.ok(stuck.includes(`${ISSUES}/new/choose`), 'Troubleshooting: the issue forms')
  assert.match(stuck, /never paste/i, 'Troubleshooting: the warning')
})
