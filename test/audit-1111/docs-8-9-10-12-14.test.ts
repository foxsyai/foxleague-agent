// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): DOCS-8, DOCS-9, DOCS-10, DOCS-12 and DOCS-14, each
// failing on the old text, and the mirrors of the money fixes that the pages and the bubbles carry (MONEY-1,
// MONEY-2, INTEG-1, INTEG-3, INTEG-5, EDGE-1, INTEG-2). Numbers are read from the code.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_SETTINGS, LEVEL_SETTINGS } from '../../src/store/settings.ts'
import { BUSY_OPENS_MARGIN_S, MAX_1V1_STRENGTH_RATIO, MAX_INHERITED_LOCK_HOURS, auctionMinRaisePercent } from '../../src/executor/rules.ts'
import { DEFAULT_TRANSFER_LOCK_HOURS, FIELD_SEATS, FIELD_TOURNAMENTS } from '../../src/snapshot/snapshot.ts'
import { MAINNET_GATE } from '../fixtures.ts'

const ROOT = new URL('../../', import.meta.url)
const raw = (f: string) => readFileSync(new URL(f, ROOT), 'utf8')
const read = (f: string) => raw(f).replace(/\s+/g, ' ')
const DOCS = 'site/src/content/docs'
const PLAYS = `${DOCS}/play/how-it-plays.md`
const LEVELS = `${DOCS}/play/strategy-levels.md`
const html = raw('src/web/dashboard.html')
/** One info bubble of the dashboard, as one line. */
function tip(name: string): string {
  const lines = html.split('\n')
  const start = lines.findIndex(l => l.startsWith(`  ${name}: [`))
  assert.ok(start >= 0, `no bubble ${name}`)
  const end = lines.findIndex((l, i) => i >= start && l.trimEnd().endsWith('`],'))
  return lines.slice(start, end + 1).join(' ').replace(/\s+/g, ' ')
}

// ---- DOCS-8 ----

test('DOCS-8 the Max shop payment bubble does not say that 2,500 buys anything in the shop', () => {
  assert.doesNotMatch(tip('shop'), /At 2,500 the agent can buy anything in the shop/)
})

test('DOCS-8 it says what 2,500 buys and what needs more, with the numbers of the levels and of the match gate', () => {
  const shop = tip('shop')
  assert.match(shop, /At 2,500 it can buy recovery, training slots, the booster and a pack/)
  // The dearest medicine: 18 days of a Legendary's longest injury at 500 a day, which is Zeus's Max shop payment.
  const zeus = LEVEL_SETTINGS.zeus!.maxShopPaymentFoxsy
  assert.equal(18 * 500, zeus)
  assert.equal(LEVEL_SETTINGS.zeus!.medicineDaysPerWeek, 18)
  // An Epic's waivable matches at its price a match come to the same amount.
  const epic = MAINNET_GATE.rarities.find(r => r.rarity === 'Epic')!
  assert.equal((epic.gate - epic.floor) * epic.price_per_match, zeus)
  assert.ok(shop.includes(`${zeus.toLocaleString('en-US')} covers the 18 days of medicine a Legendary's longest injury can take and an Epic's ${epic.gate - epic.floor} match credits`), shop)
})

// ---- DOCS-9 ----

test('DOCS-9a the booster sentence names the rate its 7 stat points belong to', () => {
  // The prompt's own sum: 11 starters, 3 matches, about 450 XP each, doubled by the booster; 2,000 XP a stat point.
  const points = (pct: number) => (11 * 3 * 450 * pct) / 100 / 2000
  assert.equal(Math.round(points(100)), 7)
  assert.ok(points(75) < 6)
  const sentence = /three sure competitive matches[^.]*roughly 7 stat points for 2,000 FOXSY[^.]*\./.exec(read(PLAYS))?.[0] ?? ''
  assert.match(sentence, /full rate/, `as it stands: ${sentence}`)
  assert.match(read(PLAYS), /a level that earns a share of the XP brings that share of it/)
})

test('DOCS-9b the field read is told as the code does it: every open tournament with an entry fee, a paid Bronze too', () => {
  assert.ok(raw('src/snapshot/snapshot.ts').includes("(t.tier === 'bronze' && t.entry_fee_foxsy > 0)"), 'readFields takes a paid Bronze')
  const page = read(PLAYS)
  assert.doesNotMatch(page, /For the 4 open Silver or Gold tournaments it could join/)
  assert.match(page, new RegExp(`For the ${FIELD_TOURNAMENTS} open Silver, Gold or paid Bronze tournaments it could join whose deadlines come first \\(up to ${FIELD_SEATS} seated teams each\\)`))
})

// ---- DOCS-10 ----

test('DOCS-10 no comma before the last "and" of a list in the five places the reviewer named', () => {
  const settings = read(`${DOCS}/use/settings.md`)
  const levels = read(LEVELS)
  const one = html.replace(/\s+/g, ' ')
  const found = [
    [one, /then 1, 2, 3, and every day for Beast and Zeus/, 'the Boosters a week bubble'],
    [one, /its tab, settings and history, and its PEM file in pem\//, 'the Delete bubble'],
    [settings, /then 1, 2, 3, and every day for beast and Zeus/, 'settings.md, Boosters a week'],
    [levels, /it weighs a win chance for every team, and it waits when nothing clearly pays/, 'strategy-levels.md, the brain'],
    [levels, /the largest entry, shop payment and bid, and how many paid training sessions/, 'strategy-levels.md, what grows'],
  ].filter(([text, re]) => (re as RegExp).test(text as string)).map(x => x[2])
  assert.deepEqual(found, [])
  // What they say is still there.
  assert.match(one, /then 1, 2 and 3; every day for Beast and Zeus/)
  assert.match(settings, /then 1, 2 and 3; every day for beast and Zeus/)
  assert.match(one, /its tab, its settings, its history and its PEM file in pem\//)
})

// ---- DOCS-12 ----

/** `setup` on a throwaway env file: what it prints, and the words it made (to check that they are not printed). */
function setupOutput(env: Record<string, string>): { out: string; words: string } {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-docs12-'))
  const out = execFileSync(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(new URL('src/cli.ts', ROOT)), 'setup'], {
    encoding: 'utf8', cwd: dir,
    env: { PATH: process.env.PATH ?? '', HOME: dir, AGENT_ENV_FILE: join(dir, 'env'), AGENT_DATA_DIR: join(dir, 'data'), ...env },
  })
  const words = /^AGENT_MNEMONIC="?([a-z ]+)"?$/m.exec(readFileSync(join(dir, 'env'), 'utf8'))?.[1] ?? ''
  assert.equal(words.split(' ').length, 24, 'the throwaway wallet was made')
  return { out, words }
}

test('DOCS-12 setup on a server does not send the owner to backup-words, which a server refuses', () => {
  assert.ok(raw('deploy/agentctl.sh').includes('AGENT_IS_SERVER=1'))
  assert.ok(raw('src/cli.ts').includes("console.error('Refused on the server: the words would land in terminal scrollback and logs there. Keep the offline backup made at setup.')"))
  const { out, words } = setupOutput({ AGENT_IS_SERVER: '1' })
  assert.match(out, /^New recovery words written to /m)
  assert.doesNotMatch(out, /backup-words/, `setup on a server names the command a server refuses: ${out}`)
  assert.match(out, /read them once in your own SSH session \(sudo grep AGENT_MNEMONIC [^)]+\/env\)/)
  assert.ok(!out.includes(words), 'the words themselves are never printed')
})

test('DOCS-12 setup on your own computer names the command that works there: ./cli.sh backup-words', () => {
  const { out, words } = setupOutput({})
  assert.match(out, /run `\.\/cli\.sh backup-words` in your own terminal/)
  assert.ok(!out.includes(words), 'the words themselves are never printed')
  // The installer drops this one line (it shows the words itself) and reads the first: both hold.
  const sh = raw('install.sh')
  assert.ok(sh.includes(`grep -v 'backup-words'`) && sh.includes(`grep -q '^New recovery words written'`))
})

// ---- DOCS-14 ----

test('DOCS-14 the home page does not promise around the clock while a new agent plans 12 hours a day', () => {
  const [from, to] = DEFAULT_SETTINGS.activeHoursUtc
  assert.equal((to - from + 24) % 24 || 24, 12)
  const home = raw(`${DOCS}/index.mdx`)
  assert.doesNotMatch(home, /around the clock/)
  assert.match(home, /every day, inside the hours you choose/)
})

// ---- the mirrors of the money fixes ----

test('the smallest raise over the top bid is FoxLeague\'s served setting, 5 percent by default, in the bid bubble and on the levels page', () => {
  assert.equal(auctionMinRaisePercent({}), 5)
  assert.equal(auctionMinRaisePercent({ auction_min_increment_percent: 12 }), 12)
  const bid = tip('bid')
  assert.doesNotMatch(bid, /beat the top bid by 5 percent\./)
  assert.doesNotMatch(bid, /each time the reserve or 5 percent over the top bid/)
  assert.match(bid, /beat the top bid by the smallest raise FoxLeague accepts \(5 percent unless FoxLeague changes it; the agent reads it before every plan\)/)
  assert.match(read(LEVELS), /the smallest raise FoxLeague accepts over the top bid \(for example 5 percent\)/)
  assert.doesNotMatch(read('README.md'), /5 percent over the top bid/)
})

test('no bid on a card whose transfer lock still runs more than 72 hours: the levels page and A day in the life say it', () => {
  assert.equal(MAX_INHERITED_LOCK_HOURS, 72)
  assert.equal(DEFAULT_TRANSFER_LOCK_HOURS / 24, 21)
  const levels = read(LEVELS)
  assert.match(levels, new RegExp(`places no bid while more than ${MAX_INHERITED_LOCK_HOURS} hours of it are left`))
  assert.match(levels, new RegExp(`for example ${DEFAULT_TRANSFER_LOCK_HOURS / 24} days`))
  assert.match(read(PLAYS), new RegExp(`never on a card whose transfer lock still runs more than ${MAX_INHERITED_LOCK_HOURS} hours`))
})

test('the pages say what the code does for the win chance, the podium rule, the match-fit count, the deadline margin and the injuries', () => {
  const plays = read(PLAYS)
  const levels = read(LEVELS)
  const pct = Math.round((MAX_1V1_STRENGTH_RATIO - 1) * 100)
  assert.equal(pct, 10)
  // MONEY-2: never above the squad-only chance.
  assert.match(levels, /the ELO expectation and the squad ratio, averaged, and never more than the two starting elevens alone give/)
  // MONEY-1: a lineup more than 10 percent above ours is clearly stronger at any ELO.
  assert.match(levels, new RegExp(`its starting eleven is more than ${pct} percent stronger than ours, whatever its rating`))
  assert.match(plays, new RegExp(`an eleven more than ${pct} percent stronger than yours counts as clearly stronger whatever its rating`))
  // INTEG-1: the 1v1 match-fit count.
  assert.match(plays, /it counts 11 match-fit players among your 18 the way FoxLeague does, an injured one not among them and a tired outfield player relieved only by an outfield player from the bench \(never by the bench keeper\)/)
  // INTEG-5: 120 seconds before a registration deadline.
  assert.equal(BUSY_OPENS_MARGIN_S / 60, 2)
  assert.match(plays, /It pays no entry and no 1v1 stake in the last two minutes before a registration deadline/)
  // INTEG-2: injuries from FoxLeague's settings.
  assert.match(plays, /FoxLeague sets these numbers and may change them: the agent reads the ones in force before every plan/)
})
