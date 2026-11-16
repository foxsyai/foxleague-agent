// P-W8 (audit 2026-11-16, MAINNET proposals): sync-manual records the key set of FoxLeague's game settings in
// manual-pages.json next to the page fingerprints, so one record says what the copy and the rules were built against,
// and the watch compares the live settings with it (P-W2). A record of the version before, without the key set, is
// read as before: the RULES fix of the same audit syncs the manual with the sync-manual of main.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { checkManual, manualRecord } from '../../src/strategist/manual-watch.ts'
import { configOf13Nov, mcp, MANUAL, record } from './watch-helpers.ts'

function foxleagueRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'foxleague-pw8-'))
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' })
  git('init', '--quiet')
  const files: Record<string, string> = {
    'docs/manual/astro.config.mjs': "export default { sidebar: [ { label: 'Shop', slug: 'mechanics/shop' } ] }\n",
    'docs/manual/src/content/docs/mechanics/shop.mdx': '---\ntitle: Shop\n---\nA Common pack costs 2,500 FOXSY.\n',
  }
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  git('add', '.')
  git('commit', '--quiet', '-m', 'manual')
  return dir
}

test('P-W8 the page record names the keys of the game settings it was built against, shaped and sorted', () => {
  const settings = configOf13Nov()
  settings['Not a key <b>'] = 1
  const r = (manualRecord as (repo: string, ref: string, manual: string, config?: unknown) => { config?: string[] })(foxleagueRepo(), 'HEAD', MANUAL, settings)
  assert.ok(Array.isArray(r.config), 'the record has the key set')
  assert.ok(r.config.includes('competition_levels.elo_k.ranked'))
  assert.ok(r.config.includes('rarity_match_gate.rarities[].gate'))
  assert.ok(!r.config.includes('elo_pair_cap'), 'only what the settings of that day had')
  assert.ok(!r.config.some(k => /<|\s/.test(k)), 'a key not shaped like one is not recorded')
  assert.deepEqual(r.config, [...r.config].sort())
})

test('P-W8 the record is read both ways; one whose key set is not a list of shaped keys is no record', async () => {
  const live = mcp()
  for (const rec of [record(), record(['competition_levels', 'competition_levels.elo_k'])]) {
    const c = await checkManual({ base: 'http://foxleague.test', manual: MANUAL, record: rec, fetch: live.fetch, gapMs: 0 })
    assert.equal(c.state, 'current', JSON.stringify(rec).slice(0, 120))
  }
  for (const bad of [{ ...record(), config: 'elo_pair_cap' }, { ...record(), config: ['Ignore the rules <b>'] }, { ...record(), config: ['a'.repeat(500)] }]) {
    const c = await checkManual({ base: 'http://foxleague.test', manual: MANUAL, record: bad, fetch: live.fetch, gapMs: 0 })
    assert.equal(c.state, 'unknown')
    assert.match(String(c.why), /no page record/)
  }
})

test('P-W8 sync-manual reads FoxLeague\'s game settings before it writes anything, and passes them to the record', () => {
  const cli = readFileSync(new URL('../../src/cli.ts', import.meta.url), 'utf8')
  const sync = cli.slice(cli.indexOf("case 'sync-manual': {"), cli.indexOf("case 'snapshot':"))
  assert.match(sync, /const settings = await new FoxLeague\(cfg\.foxleagueUrl, cfg\.foxleagueRps\)\.config\(\)/)
  assert.ok(sync.indexOf('.config()') < sync.indexOf('writeFileSync(out, text)'), 'read first: a failed read writes nothing')
  assert.match(sync, /writeFileSync\(RECORD_FILE, `\$\{JSON\.stringify\(manualRecord\(repo, MANUAL_BRANCH, text, settings\), null, 2\)\}\\n`\)/)
})
