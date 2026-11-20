// The FoxLeague player manual (docs.foxleague.ai) as plain markdown for the strategist's cached system
// prompt. `npm run cli -- sync-manual` rebuilds manual.md from the FoxLeague repository's mainnet
// branch, the source the website is built from; the file is committed and deployed with the code.

import { execFileSync } from 'node:child_process'

export const MANUAL_BRANCH = 'origin/main'
export const ROOT = 'docs/manual/src/content/docs'
/**
 * What shapes play decisions: the economy map first, every mechanics page, the players page (rarity, OVR, the yellow
 * card bans and the injuries, which no mechanics page states), fair play. A new page in these folders is taken in.
 */
const FOLDERS = ['mechanics/economy-map.mdx', 'mechanics', 'getting-started/players.md', 'legal/fair-play.md']

/**
 * Every other page of the manual, each left out on purpose (a page or a whole folder). A page that is in neither
 * list stops sync-manual and manual-status until someone decides: a new section is never skipped unseen.
 */
export const LEFT_OUT: Record<string, string> = {
  'mechanics/world-cup.mdx': 'a preview, not live',
  'mechanics/invite-friends.mdx': "the referral programme: the agents take no part in it (owner, 2026-11-19); the snapshot's Referral line gives it in short",
  'getting-started/first-match.md': 'an app walkthrough; the match rules are on the mechanics pages',
  'getting-started/onboarding.mdx': 'onboarding; registration is handled by code',
  'getting-started/quick-start.mdx': 'an app walkthrough',
  'getting-started/squad.md': 'an app walkthrough; the tactics rules are on the mechanics pages',
  'getting-started/wallet.mdx': 'wallet apps and logins; the agent signs with its own key',
  'reference': 'the FAQ and glossary: support answers and definitions the mechanics pages already give',
  'developer': 'guides for developer teams, not for playing',
  'legal/account-bans.md': "what an administrator does to a banned or an empty account and to a banned wallet's payments; nothing a plan decides: a banned wallet cannot sign in, so every read that needs a session fails and the executor refuses (fail closed), and an agent's team keeps its account from the empty-account cleanup (FoxLeague's release branch, #764; SYNC-2)",
  'legal/privacy.md': 'privacy policy',
  'legal/terms.md': 'terms of use',
  'vision': 'roadmap and plans, not live rules',
  'index.mdx': 'the welcome page',
  'connect-ai.mdx': "connecting an AI client to FoxLeague's read-only MCP server, not a game rule",
}

const under = (page: string, entry: string) => page === entry || page.startsWith(`${entry}/`)

/** The manual's pages (paths under the docs root) that are neither taken in nor left out on purpose. */
export function undecidedPages(pages: string[]): string[] {
  return pages.filter(p => !FOLDERS.some(f => under(p, f)) && !Object.keys(LEFT_OUT).some(e => under(p, e)))
}

/** Every page of the manual on the mainnet branch, as paths under the docs root. */
function manualPages(git: (...args: string[]) => string): string[] {
  return git('ls-tree', '-r', '--name-only', MANUAL_BRANCH, '--', ROOT).split('\n').filter(f => /\.mdx?$/.test(f)).map(f => f.slice(ROOT.length + 1))
}

/** One page as plain markdown: title heading, no imports or source comments, callouts as quotes. */
export function cleanPage(source: string, path: string): string {
  let body = source.replace(/\r\n/g, '\n')
  let title = path
  const fm = /^---\n([\s\S]*?)\n---\n/.exec(body)
  if (fm) {
    title = /^title:\s*(.+)$/m.exec(fm[1]!)?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? path
    body = body.slice(fm[0].length)
  }
  body = body
    .replace(/^import .*;?\s*$/gm, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<Aside([^>]*)>([\s\S]*?)<\/Aside>/g, (_m, attrs: string, inner: string) => {
      const label = /title="([^"]*)"/.exec(attrs)?.[1] ?? /type="([^"]*)"/.exec(attrs)?.[1] ?? 'Note'
      return [`> **${label}**`, ...inner.trim().split('\n').map(l => (l ? `> ${l}` : '>'))].join('\n')
    })
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  const url = `docs.foxleague.ai/${path.replace(/\.mdx?$/, '')}/`
  return `# ${title}\n(${url})\n\n${body}\n`
}

/** Reads the pages from a FoxLeague checkout (after a fetch) and returns manual.md's content. */
export function buildManual(repo: string): { text: string; pages: number; commit: string; undecided: string[] } {
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  git('fetch', '--quiet', 'origin', MANUAL_BRANCH.replace(/^origin\//, ''))
  const commit = git('log', '-1', '--format=%h %cs', MANUAL_BRANCH, '--', ROOT).trim()
  const all = manualPages(git)
  const paths: string[] = []
  for (const folder of FOLDERS) {
    for (const p of all.filter(p => under(p, folder)).sort()) {
      if (!paths.includes(p) && !Object.keys(LEFT_OUT).some(e => under(p, e))) paths.push(p)
    }
  }
  const pages = paths.map(p => cleanPage(git('show', `${MANUAL_BRANCH}:${ROOT}/${p}`), p))
  const header = [
    '# FoxLeague player manual',
    `The official player manual (docs.foxleague.ai), synced from the FoxLeague repository, ${MANUAL_BRANCH.replace(/^origin\//, '')} at ${commit}.`,
    'Rules and numbers as the platform runs them. Where a live value in the snapshot differs (fees, prices, allowances, config), the live value wins.',
    "A card's OVR is the average of its seven stats; the stats that matter for its position count for more than OVR.",
  ].join('\n')
  return { text: `${header}\n\n${pages.join('\n')}`, pages: pages.length, commit, undecided: undecidedPages(all) }
}

/**
 * Whether manual.md still matches FoxLeague's manual: the commit written in its header against the manual's
 * newest commit on the mainnet branch of a FoxLeague checkout (after a fetch).
 */
export function manualStatus(repo: string, manual: string): { synced: string; latest: string; current: boolean; undecided: string[] } {
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
  git('fetch', '--quiet', 'origin', MANUAL_BRANCH.replace(/^origin\//, ''))
  const latest = git('log', '-1', '--format=%h %cs', MANUAL_BRANCH, '--', ROOT).trim()
  const synced = / at ([0-9a-f]{7,} \d{4}-\d{2}-\d{2})\./.exec(manual.split('\n', 3).join('\n'))?.[1] ?? 'unknown'
  const undecided = undecidedPages(manualPages(git))
  return { synced, latest, current: synced === latest && !undecided.length, undecided }
}
