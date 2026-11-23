// HERO-1 (the owner, launch day 23 Nov 2026): the picture on the site's home page showed only the middle of the pitch.
// Starlight's hero draws its image at 400 by 400 (Hero.astro, `imageAttrs`), and Astro's image service crops a picture
// of another shape to fill that square: our 1520 by 1040 pitch lost both ends, our keeper and back four on the left and
// the rival's last line on the right, so 6 of "its eleven players" (the alt text) showed. A square picture is drawn
// whole: the pitch now sits in a square canvas with transparent space above and below.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', '..')

/** A PNG's width and height, from its IHDR chunk. */
function pngSize(path: string): { width: number; height: number } {
  const b = readFileSync(path)
  assert.equal(b.subarray(1, 4).toString('latin1'), 'PNG', `${path} is a PNG`)
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
}

test('HERO-1 the home page picture is square, so the 400 by 400 hero shows all of it', () => {
  const page = readFileSync(join(ROOT, 'site/src/content/docs/index.mdx'), 'utf8')
  const file = /^\s+file:\s*(\S+)\s*$/m.exec(page)?.[1]
  assert.ok(file, 'the home page names its hero picture')
  const { width, height } = pngSize(join(ROOT, 'site/src/content/docs', file))
  assert.equal(width, height, `the hero picture is ${width} by ${height}: Starlight crops it to a square`)
  assert.ok(width >= 800, 'large enough for a sharp 400 by 400 at twice the pixels')
})
