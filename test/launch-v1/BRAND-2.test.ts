// BRAND-2 (the owner, launch day 23 Nov 2026, after the announcement): the site's tab icon showed the fox on a dark
// round badge. The owner wants it transparent, like the header logo: the tab icons are the transparent fox now.
// Apple's home screen icon keeps its dark background (BRAND-1): iOS paints a transparent one black.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const BRAND = join(import.meta.dirname, '..', '..', 'site', 'public', 'brand')
const bytes = (name: string) => readFileSync(join(BRAND, name))
const sha = (name: string) => createHash('sha256').update(bytes(name)).digest('hex')

test('BRAND-2 the 192 pixel tab icon is the header logo itself: the transparent fox', () => {
  assert.ok(bytes('favicon-192.png').equals(bytes('logo.png')), 'favicon-192.png is the transparent fox of logo.png')
})

test('BRAND-2 the 32 pixel tab icon is the transparent fox drawn at 32 pixels', () => {
  // The owner's "fox head with AI brain (no background)" drawing at 32 by 32, transparent around it.
  assert.equal(sha('favicon-32.png'), 'b3ca54c788d370afa6dc1de6ea774d74ea38e6004c11cdd90dd7a7dd5922f4db')
})
