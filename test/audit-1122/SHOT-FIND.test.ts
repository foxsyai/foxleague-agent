// The Find my team screenshot (pre-release audit 2026-11-22, ATTACK's note): site/scripts/screenshots.ts filled the
// recovery words box with 24 valid throwaway words, and site/public/screenshots/import-team-find.png showed them in
// clear on the public site: a wallet nobody should ever fund, and a picture that teaches pasting real words where
// others can see them. The box now holds plain text that is no recovery phrase; the addresses of the list still come
// from throwaway words that are never shown.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'

const script = readFileSync(join(import.meta.dirname, '..', '..', 'site', 'scripts', 'screenshots.ts'), 'utf8')

test('SHOT-FIND the screenshot fills the words box with text that is no recovery phrase', () => {
  const set = /\$\('impWords'\)\.value = \$\{JSON\.stringify\((.*?)\)\}/.exec(script)
  assert.ok(set, 'the script fills the words box')
  const literal = /^(?:'([^']*)'|"([^"]*)"|([A-Z_]+))$/.exec(set[1]!.trim())
  assert.ok(literal, `the words box gets ${set[1]}, not a fixed text`)
  const name = literal[3]
  const text = name ? new RegExp(`const ${name} = '([^']*)'`).exec(script)?.[1] : (literal[1] ?? literal[2])
  assert.ok(text, `the fixed text of ${set[1]} is in the script`)
  assert.match(text, /example/i, 'it says it is an example')
  assert.throws(() => Mnemonic.fromString(text), 'the text in the box must not be a valid recovery phrase')
})
