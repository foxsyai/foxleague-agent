// The private names DOCS-11 (c) keeps out of the public repository, held as SHA-256 digests only (REL-2, pre-release
// audit 2026-11-22): the check that guards them is a tracked file too, packed into every release, so it must not
// publish what it guards. The words of each tracked file are hashed and compared with these digests; a hit is told by
// its file, its line and the first characters of its digest, never by the word.
//
// A digest hides a word from a reader, not from someone who tries every value: a two-number address prefix or a short
// user name is found that way, the project and domain words only by guessing them.
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

/** Other sites and private projects of the maintainers and the word of the owner's own dashboard domain, in lower case. */
export const PRIVATE_WORDS = new Set([
  '991d86372a5f548fbe2723c55c91992c6aedad48b1cc1f55120797f2c389a288',
  'e6cf6823c30c52e7de6c52e3aba9ea7b5c226011362331a7ad8baa8114b765aa',
  'c6deff886af74ca6683c5fa9ea9dc1dd8af567baa6d73c3c184f81bf520c4d31',
  '1b417b5e861ccf9c4ed440097686cac3b4528ce33c29873e6053cd14be640e5d',
])
/** The word of the hosting the website runs on, in lower case (the site's files do not name it). */
export const HOSTING_WORDS = new Set(['7becf04360b642f45b6fb7f7ce10dadfc51bd5b6154373065ee35e690ed37c63'])
/** The first two numbers of the maintainers' server addresses, as "a.b". */
export const ADDRESS_PREFIXES = new Set([
  '68bdccc10bae766479929239cb6cc5c9c7cd0501f1417de456dae7d3ed8a59fd',
  '7b395dc83baa32c2fbd9e8d76877dd059dc9e9a0e63a315c3d1dde0d378e6731',
])
/** The website server's deploy user, in lower case. */
export const DEPLOY_USERS = new Set(['4b5e57f6eb2f42b9039b3d1e13929295f231749c510cbe341cd68036d9af97e2'])

/**
 * The words of `text` in lower case: every run of letters and digits, and the runs of up to three of them joined by
 * "-" within a name written with dots, dashes or underscores (one_two.three gives one, two, three, one-two, two-three
 * and one-two-three).
 */
export function words(text: string): Set<string> {
  const out = new Set<string>()
  for (const run of text.toLowerCase().match(/[a-z0-9][a-z0-9._-]*/g) ?? []) {
    const parts = run.split(/[._-]+/).filter(Boolean)
    for (let i = 0; i < parts.length; i++) {
      for (let n = 1; n <= 3 && i + n <= parts.length; n++) out.add(parts.slice(i, i + n).join('-'))
    }
  }
  return out
}

/**
 * "a.b" for every two numbers followed by a dot in a dotted run of numbers (an address or its start), the first number
 * cut to its last one, two and three digits. A dot escaped for a regular expression counts as a dot.
 */
export function addressPrefixes(text: string): Set<string> {
  const out = new Set<string>()
  for (const m of text.replace(/\\+\./g, '.').matchAll(/\d+(?:\.\d+)+\.?/g)) {
    const p = m[0].split('.')
    for (let i = 0; i + 1 < p.length - 1; i++) {
      const a = p[i]!
      for (let k = 1; k <= 3 && k <= a.length; k++) out.add(`${a.slice(-k)}.${p[i + 1]}`)
    }
  }
  return out
}

/** The user names `text` gives as user@, user `name` or chown name:, in lower case, with their last part. */
export function userNames(text: string): Set<string> {
  const out = new Set<string>()
  const add = (n: string) => {
    out.add(n.toLowerCase())
    out.add(n.toLowerCase().split(/[._-]/).pop()!)
  }
  for (const m of text.matchAll(/([A-Za-z0-9._-]+)@/g)) add(m[1]!)
  for (const m of text.matchAll(/user\s+`([^`\s]+)`/g)) add(m[1]!)
  for (const m of text.matchAll(/chown\s+(?:-R\s+)?([A-Za-z0-9._-]+):/g)) add(m[1]!)
  return out
}

export interface Guard {
  words?: Set<string>
  addresses?: Set<string>
  users?: Set<string>
}

/** The digests of `g` that `text` holds, as "kind digest-start" (never the word itself). */
export function digestsIn(text: string, g: Guard): string[] {
  const hits: string[] = []
  const check = (kind: string, found: Set<string>, guarded: Set<string> | undefined) => {
    if (!guarded?.size) return
    for (const v of found) {
      const d = sha(v)
      if (guarded.has(d)) hits.push(`${kind} ${d.slice(0, 12)}`)
    }
  }
  check('word', words(text), g.words)
  check('address', addressPrefixes(text), g.addresses)
  check('user', userNames(text), g.users)
  return hits
}

/** Where in `text` the digests of `g` stand, as "file:line (kind digest-start)". */
export function hitsIn(file: string, text: string, g: Guard): string[] {
  if (!digestsIn(text, g).length) return []
  const out: string[] = []
  text.split('\n').forEach((line, i) => {
    for (const h of digestsIn(line, g)) out.push(`${file}:${i + 1} (${h})`)
  })
  // A name cut by a line break is still a hit.
  return out.length ? out : [`${file} (${digestsIn(text, g).join(', ')})`]
}

/** Every tracked file git does not take for binary, with its text. */
export function trackedTexts(repo: string): { file: string; text: string }[] {
  const files = execFileSync('git', ['-C', repo, 'grep', '-I', '-l', '-z', '-e', '', '--', '.'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).split('\0').filter(Boolean)
  return files.map(file => ({ file, text: readFileSync(join(repo, file), 'utf8') }))
}
