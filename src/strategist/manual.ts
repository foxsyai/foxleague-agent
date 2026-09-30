// The FoxLeague player manual (docs.foxleague.ai) as plain markdown for the strategist's cached system
// prompt. `npm run cli -- sync-manual` rebuilds manual.md from the FoxLeague repository's mainnet
// branch, the source the website is built from; the file is committed and deployed with the code.

import { execFileSync } from 'node:child_process'

export const MANUAL_BRANCH = 'origin/release/mainnet-1.0'
const ROOT = 'docs/manual/src/content/docs'
/**
 * What shapes play decisions: the economy map first, every mechanics page, fair play. Left out:
 * getting started (onboarding and app walkthroughs; registration is handled by code), the FAQ and
 * glossary (support answers and definitions the mechanics pages already give), the World Cup preview
 * (not live), developer guides, privacy, terms and the roadmap.
 */
const FOLDERS = ['mechanics/economy-map.mdx', 'mechanics', 'legal/fair-play.md']
const SKIP = new Set(['mechanics/world-cup.mdx'])

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
export function buildManual(repo: string): { text: string; pages: number; commit: string } {
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  git('fetch', '--quiet', 'origin', MANUAL_BRANCH.replace(/^origin\//, ''))
  const commit = git('log', '-1', '--format=%h %cs', MANUAL_BRANCH, '--', ROOT).trim()
  const all = git('ls-tree', '-r', '--name-only', MANUAL_BRANCH, '--', ROOT).split('\n').filter(f => /\.mdx?$/.test(f))
  const paths: string[] = []
  for (const folder of FOLDERS) {
    for (const f of all.filter(f => f === `${ROOT}/${folder}` || f.startsWith(`${ROOT}/${folder}/`)).sort()) {
      if (!paths.includes(f) && !SKIP.has(f.slice(ROOT.length + 1))) paths.push(f)
    }
  }
  const pages = paths.map(f => cleanPage(git('show', `${MANUAL_BRANCH}:${f}`), f.slice(ROOT.length + 1)))
  const header = [
    '# FoxLeague player manual',
    `The official player manual (docs.foxleague.ai), synced from the FoxLeague repository, ${MANUAL_BRANCH.replace(/^origin\//, '')} at ${commit}.`,
    'Rules and numbers as the platform runs them. Where a live value in the snapshot differs (fees, prices, allowances, config), the live value wins.',
    "A card's OVR is the average of its seven stats; the stats that matter for its position count for more than OVR.",
  ].join('\n')
  return { text: `${header}\n\n${pages.join('\n')}`, pages: pages.length, commit }
}
