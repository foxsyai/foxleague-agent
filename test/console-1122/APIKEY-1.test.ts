// APIKEY-1: the owner, 2026-11-22. Anthropic's console now asks "Where does your code run?" when Create key is
// pressed: Your own machine (sign in with the ant command line tool, "No key needed"), Cloud or Kubernetes, CI
// pipeline and Somewhere else ("Use an API key, including with tools that require one"). The agent needs an API key
// (ANTHROPIC_API_KEY): Your own machine sends the owner to a terminal script that our install cannot use. Every list
// of the key's steps says to choose Somewhere else: the installer, INSTALL.md, the site's Keys page and the
// dashboard's guide. The key's Expires defaults to 30 days: the agents would stop on that day, so the steps say Never
// (the owner, 2026-11-22); the monthly spend limit of the step before caps what a key can cost.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const REPO = join(import.meta.dirname, '..', '..')
const read = (p: string) => readFileSync(join(REPO, p), 'utf8')
const flat = (p: string) => read(p).replace(/\s+/g, ' ')
const LINE = '     d. Create key (Somewhere else), name foxleague-agent, Expires Never, copy it (once):'

test('APIKEY-1 every list of the AI key steps says Somewhere else when the console asks where the code runs, and Expires Never', () => {
  // The installer's 4/7 Keys help: one line, found by its text (R89A-2), so the line numbers the install videos quote
  // stay where they are.
  const lines = read('install.sh').split('\n')
  const at = lines.findIndex(l => /^ {5}d\. .*Create key/.test(l))
  assert.ok(at >= 0, 'the installer names Create key in its 4/7 Keys help')
  assert.equal(lines[at], LINE)
  assert.equal(lines.filter(l => l.includes('Create key')).length, 1, 'one line of the installer names it')
  assert.match(flat('INSTALL.md'), /press\ Create\ key\.\ Where\ the\ console\ asks\ where\ your\ code\ runs,\ choose\ Somewhere\ else\ \(an\ API\ key\):\ the\ other\ choices\ sign\ in\ a\ command\ line\ tool\ the\ agent\ does\ not\ use\.\ Name\ the\ key\ foxleague\-agent,\ set\ Expires\ to\ Never\ and\ leave\ the\ rest\ as\ it\ is:\ a\ key\ that\ expires\ stops\ your\ agents\ on\ that\ day;\ the\ monthly\ limit\ above\ caps\ what\ it\ can\ cost\.\ Copy\ it:\ it\ is\ shown\ only\ once\./)
  assert.match(flat('site/src/content/docs/start/keys.mdx'), /press\ \*\*Create\ key\*\*\.\ Where\ the\ console\ asks\ where\ your\ code\ runs,\ choose\ \*\*Somewhere\ else\*\*\ \(an\ API\ key\):\ the\ other\ choices\ sign\ in\ a\ command\ line\ tool\ the\ agent\ does\ not\ use\.\ Name\ the\ key\ `foxleague\-agent`,\ set\ Expires\ to\ \*\*Never\*\*\ and\ leave\ the\ rest\ as\ it\ is:\ a\ key\ that\ expires\ stops\ your\ agents\ on\ that\ day;\ the\ monthly\ limit\ above\ caps\ what\ it\ can\ cost\.\ Copy\ it:\ it\ is\ shown\ only\ once\./)
  assert.match(read('src/web/dashboard.html'), /\['Open\ API\ keys\ and\ press\ Create\ key\.\ Where\ the\ console\ asks\ where\ your\ code\ runs,\ choose\ Somewhere\ else\ \(an\ API\ key\):\ the\ other\ choices\ sign\ in\ a\ command\ line\ tool\ the\ agent\ does\ not\ use\.\ Name\ the\ key\ foxleague\-agent,\ set\ Expires\ to\ Never\ and\ leave\ the\ rest\ as\ it\ is:\ a\ key\ that\ expires\ stops\ your\ agents\ on\ that\ day;\ the\ monthly\ limit\ above\ caps\ what\ it\ can\ cost\.\ Copy\ it:\ it\ is\ shown\ only\ once\.',\ 'https:\/\/platform\.claude\.com\/settings\/keys'\]/)
  // The install videos quote the installer's line as it is.
  assert.ok(read('site/scripts/videos/src/text.mjs').includes(`[sh(${at + 1}, '${LINE}')]`), 'the videos quote the line at its own number')
})
