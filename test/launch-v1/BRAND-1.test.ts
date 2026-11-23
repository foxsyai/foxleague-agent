// BRAND-1 (the owner, launch day 23 Nov 2026): the site's header logo, its tab icons and the link preview card still
// showed FoxLeague's fox head and the Foxsy ball. They show the FoxLeague Agent fox now (the fox head with the AI
// brain): the transparent fox in the dark header, the round badge as the tab and home screen icon (it reads at 32
// pixels; Apple's home screen icon has no transparency) and both in the preview card. The card's address carries a
// version, so X and Telegram fetch the new card instead of the one they keep for days.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const SITE = join(import.meta.dirname, '..', '..', 'site')
const CONFIG = readFileSync(join(SITE, 'astro.config.mjs'), 'utf8')

/** A PNG's width, height and whether it has an alpha channel (its IHDR chunk). */
function png(path: string): { width: number; height: number; alpha: boolean } {
  const b = readFileSync(path)
  assert.equal(b.subarray(1, 4).toString('latin1'), 'PNG', `${path} is a PNG`)
  const colorType = b[25]!
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), alpha: colorType === 4 || colorType === 6 }
}

test('BRAND-1 the header shows the agent logo, a file of its own beside the tab icons', () => {
  const logo = /logo:\s*\{\s*src:\s*'\.\/([^']+)'/.exec(CONFIG)?.[1]
  assert.equal(logo, 'public/brand/logo.png', 'the header logo is the agent fox, not a tab icon')
  assert.ok(existsSync(join(SITE, logo)))
  assert.deepEqual(png(join(SITE, logo)), { width: 192, height: 192, alpha: true }, 'transparent on the dark header')
})

test('BRAND-1 the tab and home screen icons have their sizes; the home screen one has no transparency', () => {
  assert.match(CONFIG, /favicon: '\/brand\/favicon-32\.png'/)
  assert.deepEqual(png(join(SITE, 'public/brand/favicon-32.png')), { width: 32, height: 32, alpha: true })
  assert.deepEqual(png(join(SITE, 'public/brand/favicon-192.png')), { width: 192, height: 192, alpha: true })
  assert.deepEqual(png(join(SITE, 'public/brand/favicon-180.png')), { width: 180, height: 180, alpha: false })
})

test('BRAND-1 the link preview card keeps its size and its address carries a version against cached cards', () => {
  assert.deepEqual(png(join(SITE, 'public/og.png')), { width: 1200, height: 630, alpha: false })
  assert.match(CONFIG, /property: 'og:image', content: 'https:\/\/agent\.foxleague\.ai\/og\.png\?v=\d+'/)
})
