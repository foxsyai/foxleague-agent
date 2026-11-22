// TEXT-1: the owner, 2026-11-22, reading the dashboard before the public release. Two of the owner's text rules for
// everything a user reads: no em dash and no comma before "and" or "or" (an Oxford comma, or two clauses joined with a
// comma and "and"). The dashboard's info bubbles and its Getting started guide held 25 of them. And the Activity
// bubble told every owner about shadow plans, which are off unless switched on on the machine that runs the agent: the
// paragraph now shows only while the list holds a shadow plan, as the filter for them does.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const html = readFileSync(join(import.meta.dirname, '..', '..', 'src/web/dashboard.html'), 'utf8')
const plain = (s: string) => s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ')

test('TEXT-1 no info bubble and no line of the guide holds an em dash or a comma before "and" or "or"', () => {
  const tips = html.slice(html.indexOf('const TIPS = {'), html.indexOf('\nfunction showTip'))
  const guide = html.slice(html.indexOf('const GUIDE = ['), html.indexOf('\n]\n', html.indexOf('const GUIDE = [')))
  assert.ok(tips.length > 20_000 && guide.length > 3_000, 'both found')
  const hits = [...plain(tips + guide).matchAll(/[^.;:]{0,60}(?:, and |, or |—)[^.;:]{0,40}/g)].map(m => m[0].trim())
  assert.deepEqual(hits, [])
})

test('TEXT-1 the info bubbles speak of shadow plans only where shadow plans are set (Activity: only while the list holds one)', () => {
  // The fixed texts of every bubble say nothing of them: they are off unless switched on on the machine that runs the agent.
  const tips = html.slice(html.indexOf('const TIPS = {'), html.indexOf('\n// Shadow plans are off unless'))
  assert.doesNotMatch(tips, /shadow/i)
  assert.match(html, /const SHADOW_TIP = `<p>A row marked <b>shadow plan, not carried out<\/b> is what another AI model would have planned from the same request\./)
  // The sentences that come back once they are set: the Activity paragraph and the password rule of the three AI choices.
  assert.match(html, /k_strat: '<p>A switch that starts shadow plans asks for your password too: a shadow model set on the server rests while it is the model that plays\.<\/p>'/)
  assert.match(html, /aiModel: '<p>A change that starts shadow plans set on the server for this agent asks for your password too\.<\/p>'/)
  assert.match(html, /aiEffort: '<p>A shadow plan set on the server at the effort this agent plays rests: leaving that effort starts it, so that asks for the password too\.<\/p>'/)
  const src = ['shadowsSet', 'tipBody'].map(n => html.match(new RegExp(`\\nfunction ${n}\\(\\) \\{[\\s\\S]*?\\n\\}\\n|\\nfunction ${n}\\(k\\) \\{[\\s\\S]*?\\n\\}\\n`))?.[0])
  assert.ok(src.every(Boolean), 'shadowsSet and tipBody are in the dashboard')
  const extra = html.match(/const SHADOW_EXTRA = \{[\s\S]*?\n\}\n/)?.[0]
  assert.ok(extra, 'SHADOW_EXTRA is in the dashboard')
  const TIPS = { activity: ['Activity', '<p>fixed</p>'], aiModel: ['AI model', '<p>model</p>'], k_strat: ['Strategist', '<p>strat</p>'], wallet: ['Wallet', '<p>wallet</p>'] }
  const body = (k: string, S: unknown, rows: { kind: string }[]) =>
    new Function('TIPS', 'SHADOW_TIP', 'S', 'activityRows', `${extra}${src.join('')}; return tipBody(${JSON.stringify(k)})`)(TIPS, '<p>shadow rows</p>', S, rows)
  const none = { instance: { shadowModels: [] }, agents: [{ ai: { shadows: [] } }] }
  const set = { instance: { shadowModels: [] }, agents: [{ ai: { shadows: ['same'] } }] }
  assert.equal(body('aiModel', none, []), '<p>model</p>')
  assert.equal(body('aiModel', set, []), '<p>model</p><p>A change that starts shadow plans set on the server for this agent asks for your password too.</p>')
  assert.equal(body('k_strat', { instance: { shadowModels: ['claude-opus-5-5'] }, agents: [] }, []).endsWith('rests while it is the model that plays.</p>'), true)
  assert.equal(body('wallet', set, []), '<p>wallet</p>', 'a bubble with nothing to add')
  // Activity: by the rows in the list, not by the setting.
  assert.equal(body('activity', set, [{ kind: 'plan' }]), '<p>fixed</p>')
  assert.equal(body('activity', none, [{ kind: 'plan' }, { kind: 'shadow' }]), '<p>fixed</p><p>shadow rows</p>')
  assert.match(html, /\$\('tipBody'\)\.innerHTML = tipBody\(k\)/)
})

test('MONTH-1 the monthly budget says when its month starts again and what the month you start in holds', async () => {
  // The owner, 2026-11-22: "if I start on the 22nd, I have 8 days of it?" The ledger keys a payment by its UTC calendar
  // month (spend.month is the payment time's YYYY-MM): it starts again on the 1st at 00:00 UTC, not at the 14:00 reset.
  const { readFileSync: rf } = await import('node:fs')
  const db = rf(join(import.meta.dirname, '..', '..', 'src/store/db.ts'), 'utf8')
  assert.match(db, /s\.at\.toISOString\(\)\.slice\(0, 7\)/, 'the month a payment counts in is its UTC calendar month')
  const tip = html.match(/monthly: \['Monthly budget \(USD\)', `([^`]*)`/)?.[1] ?? ''
  assert.match(tip, /It starts again on the 1st at 00:00 UTC, not at the 14:00 UTC game-day reset\. In the month you start, the whole budget is there for the days left in it; the daily cap still limits each day\./)
  const page = readFileSync(join(import.meta.dirname, '..', '..', 'site/src/content/docs/use/settings.md'), 'utf8')
  assert.match(page, /\| Monthly budget \| \$150 \| The most this agent may spend in a calendar month \(UTC\): it starts again on the 1st at 00:00 UTC\. In the month you start, the whole budget is there for the days left in it; the daily cap still limits each day\./)
})

test('ENTRY-1 the Max entry fee bubble names the three bands, Bronze too, and that a 1v1 stake starts at Silver', () => {
  // The owner, 2026-11-22. FoxLeague's live tournament_fee_bounds that day: bronze 100 to 999, silver 1,000 to 5,000 (the
  // effective top 4,999, tierBounds), gold from 5,000; a 1v1 stake runs on the Silver and Gold bounds only.
  const tip = html.match(/entry: \['Max entry fee or stake \(FOXSY\)', `([^`]*)`/)?.[1] ?? ''
  assert.match(tip, /<p>A paid Bronze tournament takes 100 to 999 FOXSY a seat, Silver 1,000 to 4,999 and Gold 5,000 or more\. A 1v1 stake starts at Silver \(1,000\)\. Below 5,000 the agent never enters Gold\.<\/p>/)
  const page = readFileSync(join(import.meta.dirname, '..', '..', 'site/src/content/docs/use/settings.md'), 'utf8')
  assert.match(page, /A paid Bronze tournament takes 100 to 999 FOXSY a seat, Silver 1,000 to 4,999 and Gold 5,000 or more\. A 1v1 stake starts at Silver \(1,000\)\./)
})

test('BIDTEXT-1 the bid limit bubbles explain the rule, with no default backstory and no dated price', () => {
  // The owner, 2026-11-22: "The default, 38,000, is about 20 percent above the Legendary's market price when it was
  // set" went stale (Legendaries sold near 47,000 that day) and never followed the owner's own value. The five rarity
  // bubbles now say the same general thing; the coloured line under each field shows today's market.
  const tip = (k: string) => html.match(new RegExp(`\\n  ${k}: \\['[^']*', \`([^\`]*)\``))?.[1] ?? ''
  const rarities = [['Common', 'a', 'Commons'], ['Uncommon', 'an', 'Uncommons'], ['Rare', 'a', 'Rares'], ['Epic', 'an', 'Epics'], ['Legendary', 'a', 'Legendaries']]
  for (const [r, art, plural] of rarities) {
    const t = tip(`bid${r}`).replace(/\s+/g, ' ')
    assert.ok(t.startsWith(`<p>The most the agent may bid for ${art} ${r} card. It is a ceiling, not a target: the agent aims below the market price it sees and bids the reserve or the smallest raise that wins, at most twice on one auction.`), r)
    assert.match(t, new RegExp(`<p>The line under the field compares your limit with what ${plural} sell for today: green when your limit covers the market, amber when it is below it \\(the agent may miss most sales\\), red when it is well above it \\(the agent may pay up to your limit\\)\\. The button fills in the market price, rounded; Save keeps it\\.</p>`), r)
    assert.match(t, new RegExp(`<p>The lowest of this, Max bid and the cost of building the card yourself is the limit that counts\\. Raising it asks for your password; 0 turns bids on ${plural} off\\.</p>`), r)
    assert.doesNotMatch(t, /default|when it was set|percent above|\d{3}/i, `${r}: no default backstory, no price`)
  }
  const bid = tip('bid')
  assert.doesNotMatch(bid, /At today's prices|by default \d/)
  const page = readFileSync(join(import.meta.dirname, '..', '..', 'site/src/content/docs/use/settings.md'), 'utf8')
  const rows = page.split('\n').filter(l => /^\| Max bid/.test(l)).join('\n')
  assert.doesNotMatch(rows, /when it was set|percent above|about 14,450|the Rare's market price/)
})

test('HOURS-1 a new agent plays from 06:00 to 22:00 UTC, and the pages and bubbles say so', async () => {
  // The owner, 2026-11-22: 16 hours, 08:00 to midnight in Romania in winter (UTC+2), the window the owner's own agents
  // play since 2026-10-27; it was 08:00 to 20:00 UTC. At the 2-hour tick that is 8 plans a day, about $0.80 at $0.10.
  const { DEFAULT_SETTINGS } = await import('../../src/store/settings.ts')
  assert.deepEqual(DEFAULT_SETTINGS.activeHoursUtc, [6, 22])
  const tip = html.match(/hours: \['[^']*', `([^`]*)`/)?.[1] ?? ''
  assert.match(tip, /The default, from 6 until 22, is 16 hours around the 14:00 UTC game-day reset\./)
  assert.match(tip, /Add your time zone's offset to read them locally: at UTC\+2, 6 until 22 is 08:00 to 00:00\./)
  const read = (p: string) => readFileSync(join(import.meta.dirname, '..', '..', p), 'utf8')
  assert.match(read('site/src/content/docs/use/settings.md'), /\| Active hours \| 06:00 to 22:00 UTC \| The agent plans only inside this window, in UTC: 16 hours around the 14:00 UTC game-day reset\./)
  for (const f of ['INSTALL.md', 'site/src/content/docs/help/troubleshooting.md', 'site/src/content/docs/play/strategy-levels.md']) {
    const text = read(f).replace(/\s+/g, ' ')
    assert.match(text, /06:00 to 22:00 UTC/, f)
    assert.doesNotMatch(text, /08:00 to 20:00 UTC/, f)
  }
})
