// Operator CLI. `npm run cli -- <command>`.

import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { envFilePath, loadConfig } from './config.ts'
import { Chain } from './chain/gateway.ts'
import { FoxLeague } from './foxleague/api.ts'
import { takeSnapshot, type MatchFactsCache } from './snapshot/snapshot.ts'
import type { MatchFormations } from './foxleague/types.ts'
import type { MarketSale, MarketSalesCache } from './snapshot/market.ts'
import { renderDigest, snapshotToJson } from './snapshot/digest.ts'
import { assertSameWords, deriveWallet, exportPem, generateMnemonicInto, shardOf, type AgentWallet } from './wallet/wallet.ts'
import { Store } from './store/db.ts'
import { secretsFile, writeSecrets } from './store/secrets.ts'
import { Executor, formatResult, liveSigningAllowed } from './executor/executor.ts'
import { parseAction, type PlannedAction } from './executor/actions.ts'
import { budgetView } from './executor/budget.ts'
import { Strategist, renderPlanRequest, strategistChoice } from './strategist/strategist.ts'
import { buildManual, manualStatus } from './strategist/manual.ts'
import { checkKeys, pickOwnerChat, promptHidden, setEnvValues, telegramMe, telegramRecentChats } from './setup/keys.ts'
import { Address } from '@multiversx/sdk-core'
import { randomBytes, randomInt } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { hashPassword } from './web/auth.ts'
import { numberToIndex, agentName } from './names.ts'
import { loadImportedWallet } from './wallet/imported.ts'
import { neverUsedOrWhy, removePemFile } from './delete-agent.ts'
import { TopUps } from './topup.ts'

const REPO_ROOT = resolve(import.meta.dirname, '..')

function usage(): never {
  console.log(`foxleague-agent CLI (agents are numbered from 1)

  setup                         create the install's recovery words in the env file (once) and print agent 1's address
  backup-words                  print the recovery words for an offline backup (only in an interactive terminal)
  check-words                   check that the recovery words still give every agent its saved address (the
                                installer runs it before it starts the agent)
  address <N>                   print agent N's address and shard
  agents                        list this install's agents: number and address, one per line
  delete-agent <N> [N...]       delete agents whose wallet was never used (checked on chain and on FoxLeague
                                first); + Add agent makes the same wallet again
  deleted-agents                list the deleted agents (number and address), read by deploy/sync-pems.sh
  export-pem <N> <path>         write agent N's PEM under pem/ or outside the repo (local only; never on the server)
  sync-manual [foxleague-repo]  rebuild src/strategist/manual.md from the FoxLeague repo's mainnet branch
                                (default ../next-foxleague); commit and deploy it afterwards
  manual-status [foxleague-repo]  say whether the strategist's game knowledge still matches FoxLeague's manual
  snapshot <N> [--json]         read-only snapshot of agent N (public API, chain, the agent's own authed routes)
  watch <erd1...> [--json]      public-only snapshot of any team (no login)
  dry-run <N> '<actions json>'  run a hand-written plan for agent N in dry run (always simulated, never signed)
  simulate-as <erd1...> '<actions json>'
                                simulate a plan as if that public wallet sent it (no key, no signature,
                                nothing broadcast): checks the transaction encodings against mainnet
  plan <N | erd1...>            ask the strategist for a plan (agent N or any public team, read-only) and dry-run
                                it; without ANTHROPIC_API_KEY, print the request the model would receive
  tick <N>                      one full service tick for agent N (snapshot, plan, execute per the platform mode)
  kill on|off                   kill switch: every agent refuses every action while on
  pause <N> | resume <N>        pause or resume one agent
  mode [dry|live]               one mode for all agents (live also needs AGENT_LIVE_ENABLED=1 in the env)
  log [N]                       recent activity
  configure                     enter the API keys with hidden input; they go straight into the env file
  check-keys                    verify the Anthropic, Telegram and Binance keys (Binance: withdraw-only, IP-locked)
  set-web-password              web UI username and password (stored as a scrypt hash) and the session key
`)
  process.exit(1)
}

function mnemonicOrExit(): string {
  const m = loadConfig().mnemonic
  if (!m) {
    console.error(`No AGENT_MNEMONIC in ${envFilePath()}: run \`npm run cli -- setup\` first.`)
    process.exit(1)
  }
  return m
}

/** The agent number people type (1 or more) as the internal index. */
function agentIndex(arg: string | undefined): number {
  return numberToIndex(arg) ?? usage()
}

/**
 * The CLI never adds an agent to the real database: a row written here would be scheduled by the running service at
 * its next start and shown in the dashboard, unpaused and past AGENT_MAX_AGENTS. Agents are added in the dashboard.
 */
function existingAgent(store: Store, index: number): void {
  if (!store.agent(index)) throw new Error(`no ${agentName(index)}: add it in the dashboard (simulate-as runs a throwaway wallet)`)
}

/** An agent's wallet: an imported team's own key, else account N-1 of the recovery words. */
function walletOf(store: Store, index: number): AgentWallet {
  const row = store.agent(index)
  return row?.source === 'imported' ? loadImportedWallet(loadConfig().dataDir, row.address, index) : deriveWallet(mnemonicOrExit(), index)
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2)
  const cfg = loadConfig()
  switch (cmd) {
    case 'setup': {
      const envFile = envFilePath()
      const { created } = generateMnemonicInto(envFile)
      delete process.env.AGENT_MNEMONIC
      process.loadEnvFile(envFile)
      const mnemonic = process.env.AGENT_MNEMONIC!
      console.log(created ? `New recovery words written to ${envFile} (mode 600).` : `Recovery words already exist in ${envFile}; left unchanged.`)
      console.log(`Agent 1 address: ${deriveWallet(mnemonic, 0).address}`)
      if (created) console.log('Write the words down offline now: run `npm run cli -- backup-words` in your own terminal.')
      return
    }
    case 'backup-words': {
      if (cfg.isServer) {
        console.error('Refused on the server: the words would land in terminal scrollback and logs there. Keep the offline backup made at setup.')
        process.exit(1)
      }
      const m = mnemonicOrExit()
      if (!process.stdout.isTTY) {
        console.error('Refused: the words are printed only to an interactive terminal (not to a pipe, log or agent).')
        process.exit(1)
      }
      console.log(m.split(/\s+/).map((w, i) => `${String(i + 1).padStart(2)}. ${w}`).join('\n'))
      return
    }
    case 'check-words': {
      // A new install has no database yet: nothing to compare.
      if (!existsSync(join(cfg.dataDir, 'agent.db'))) return
      const store = new Store(cfg.dataDir)
      assertSameWords([...store.agents(), ...store.retiredAgents()], mnemonicOrExit(), envFilePath(), cfg.dataDir)
      return
    }
    case 'address': {
      const w = deriveWallet(mnemonicOrExit(), agentIndex(args[0]))
      console.log(`${agentName(w.index)}: ${w.address} (shard ${w.shard})`)
      return
    }
    case 'agents': {
      // Read by deploy/sync-pems.sh from a server: public data only (agent numbers and addresses). Retired agents
      // are listed too, so their PEM files exist when the owner wants to play such a team by hand.
      const store = new Store(cfg.dataDir)
      for (const b of [...store.agents(), ...store.retiredAgents()].sort((x, y) => x.index - y.index)) console.log(`${b.index + 1} ${b.address}${b.source === 'imported' ? ' imported' : ''}`)
      return
    }
    case 'delete-agent': {
      // The same check as the dashboard's Delete. A running service stops scheduling an agent once it is gone.
      if (!args.length) usage()
      const store = new Store(cfg.dataDir)
      const deps = {
        store,
        chain: new Chain(cfg),
        fox: new FoxLeague(cfg.foxleagueUrl, cfg.foxleagueRps),
        // Only read here: whether a Binance top-up still waits for the agent.
        topups: new TopUps({ store, key: () => null, accountType: () => undefined, live: () => false } as never),
        agentCount: Math.min(cfg.maxAgents, Math.max(1, Number(process.env.AGENT_COUNT ?? 1))),
      }
      let failed = false
      for (const n of args) {
        const index = agentIndex(n)
        try {
          const agent = await neverUsedOrWhy(deps, index)
          store.deleteAgent(index, 'the CLI')
          store.log({ agentIndex: null, kind: 'control', status: 'info', summary: `${agentName(index)} (${agent.address}) deleted from the CLI: its wallet was never used` })
          const pem = cfg.isServer ? 'none' : removePemFile(process.env.AGENT_PEM_DIR?.trim() || join(REPO_ROOT, 'pem'), index, agent.address)
          console.log(`${agentName(index)} (${agent.address}) deleted.${pem === 'deleted' ? ' Its PEM file is deleted too.' : pem === 'kept' ? ' Its PEM file was kept: it is not this wallet\'s file.' : ''}`)
        } catch (err) {
          failed = true
          console.error(`${agentName(index)} kept: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      if (cfg.isServer) console.log('On your computer, ./deploy/sync-pems.sh removes the PEM files of the deleted agents.')
      if (failed) process.exit(1)
      return
    }
    case 'deleted-agents': {
      // For deploy/sync-pems.sh: the agents deleted for good, unless the same number is an agent with that wallet again.
      const store = new Store(cfg.dataDir)
      const now = new Map([...store.agents(), ...store.retiredAgents()].map(b => [b.index, b.address]))
      const seen = new Set<number>()
      for (const d of [...store.deletedAgents()].reverse()) {
        if (seen.has(d.index)) continue
        seen.add(d.index)
        if (now.get(d.index) !== d.address) console.log(`${d.index + 1} ${d.address}`)
      }
      return
    }
    case 'export-pem': {
      const [n, path] = args
      if (!path) usage()
      if (new Store(cfg.dataDir).agent(agentIndex(n))?.source === 'imported') throw new Error(`${agentName(agentIndex(n))} is an imported team: its PEM file is the one you imported`)
      const out = exportPem(mnemonicOrExit(), agentIndex(n), path, { isServer: cfg.isServer, repoRoot: REPO_ROOT })
      console.log(`Wrote ${out} (mode 600). Keep it on this machine; never copy it to the server or into git.`)
      return
    }
    case 'manual-status': {
      const repo = resolve(args[0] ?? join(REPO_ROOT, '..', 'next-foxleague'))
      if (!existsSync(join(repo, '.git'))) throw new Error(`${repo} is not a FoxLeague checkout; pass its path`)
      const st = manualStatus(repo, readFileSync(join(REPO_ROOT, 'src', 'strategist', 'manual.md'), 'utf8'))
      if (st.synced !== st.latest) console.log(`GAME KNOWLEDGE IS BEHIND: it was synced at ${st.synced}, FoxLeague's manual is at ${st.latest}. Run: npm run cli -- sync-manual, then commit and deploy.`)
      if (st.undecided.length) console.log(undecidedText(st.undecided))
      if (st.current) console.log(`Game knowledge is up to date with FoxLeague's manual (${st.latest}).`)
      if (!st.current) process.exitCode = 2
      return
    }
    case 'sync-manual': {
      const repo = resolve(args[0] ?? join(REPO_ROOT, '..', 'next-foxleague'))
      if (!existsSync(join(repo, '.git'))) throw new Error(`${repo} is not a FoxLeague checkout; pass its path`)
      const { text, pages, commit, undecided } = buildManual(repo)
      // A page nobody has decided on stops the sync: it might be a new rule the agent would not know.
      if (undecided.length) {
        console.error(undecidedText(undecided))
        process.exit(2)
      }
      const out = join(REPO_ROOT, 'src', 'strategist', 'manual.md')
      writeFileSync(out, text)
      console.log(`Wrote ${out}: ${pages} pages, ${Math.round(text.length / 1024)} KB (about ${Math.round(text.length / 2.7 / 1000)}k tokens; tables run about 2.7 characters a token), manual at ${commit}.`)
      console.log('Commit and deploy it; the strategist reads it at start.')
      return
    }
    case 'snapshot':
    case 'watch': {
      const chain = new Chain(cfg)
      const fox = new FoxLeague(cfg.foxleagueUrl, cfg.foxleagueRps)
      let target: { wallet: ReturnType<typeof deriveWallet> } | { watch: string }
      if (cmd === 'snapshot') {
        target = { wallet: walletOf(new Store(cfg.dataDir), agentIndex(args[0])) }
      } else {
        const addr = args[0] ?? ''
        if (!/^erd1[0-9a-z]{58}$/.test(addr)) usage()
        target = { watch: addr }
      }
      const snap = await takeSnapshot({ chain, fox }, target, new Date(), { matchFacts: memoryFacts(), marketSales: memorySales() })
      console.log(args.includes('--json') ? snapshotToJson(snap) : renderDigest(snap))
      return
    }
    case 'dry-run':
    case 'simulate-as': {
      const chain = new Chain(cfg)
      const fox = new FoxLeague(cfg.foxleagueUrl, cfg.foxleagueRps)
      const plan = parsePlan(args[1])
      let wallet: AgentWallet
      let store: Store
      let index: number
      if (cmd === 'dry-run') {
        index = agentIndex(args[0])
        store = new Store(cfg.dataDir)
        existingAgent(store, index)
        wallet = walletOf(store, index)
      } else {
        const addr = args[0] ?? ''
        if (!/^erd1[0-9a-z]{58}$/.test(addr)) usage()
        wallet = watchWallet(addr)
        index = 900
        store = new Store(cfg.dataDir, ':memory:')
        store.addAgent(index, addr)
      }
      const agent = { ...store.agent(index)!, dryRun: true }
      const snap = await takeSnapshot({ chain, fox }, cmd === 'dry-run' ? { wallet } : { watch: wallet.address })
      const exec = new Executor({ cfg, chain, fox, store })
      for (const r of await exec.run(agent, wallet, snap, plan)) console.log(formatResult(index, r), '\n')
      return
    }
    case 'plan': {
      const chain = new Chain(cfg)
      const fox = new FoxLeague(cfg.foxleagueUrl, cfg.foxleagueRps)
      const target = args[0] ?? usage()
      const isWatch = target.startsWith('erd1')
      const index = isWatch ? 900 : agentIndex(target)
      const store = isWatch ? new Store(cfg.dataDir, ':memory:') : new Store(cfg.dataDir)
      if (!isWatch) existingAgent(store, index)
      const wallet = isWatch ? watchWallet(target) : walletOf(store, index)
      if (isWatch) store.addAgent(index, wallet.address) // the throwaway in-memory store
      const agent = { ...store.agent(index)!, dryRun: true }
      const snap = await takeSnapshot({ chain, fox }, isWatch ? { watch: wallet.address } : { wallet }, new Date(), { matchFacts: { get: k => store.matchFacts(k), put: (k, f) => store.putMatchFacts(k, f) }, marketSales: { has: id => store.hasSale(id), put: rows => store.putSales(rows), since: iso => store.salesSince(iso), complete: () => store.salesComplete, markComplete: () => store.markSalesComplete() } })
      const input = { snapshot: snap, settings: agent.settings, budget: budgetView(store, index, agent.settings, true, new Date()), recent: store.activity(index, 20), dryRun: true }
      if (!cfg.anthropicApiKey) {
        console.log('(no ANTHROPIC_API_KEY: this is the request the strategist would receive)\n')
        console.log(renderPlanRequest(input))
        return
      }
      const choice = strategistChoice(store, cfg)
      const plan = await new Strategist(cfg.anthropicApiKey, choice.model, choice.effort).plan(input)
      console.log(`PLAN: ${plan.summary}\nmodel $${plan.usage.usd.toFixed(4)}, in ${plan.usage.inputTokens} (+${plan.usage.cacheReadTokens} cached, ${plan.usage.cacheWriteTokens} written), out ${plan.usage.outputTokens}, stop ${plan.stopReason}`)
      for (const r of plan.rejected) console.log(`rejected proposal: ${r.error} ${JSON.stringify(r.raw)}`)
      const exec = new Executor({ cfg, chain, fox, store })
      for (const r of await exec.run(agent, wallet, snap, plan.actions)) console.log(formatResult(index, r), '\n')
      return
    }
    case 'tick': {
      const { Service, serviceRunning } = await import('./service.ts')
      const pid = serviceRunning(cfg.dataDir)
      if (pid !== null) {
        // Two processes would each pass the caps for their own action (the per-agent lock lives in one process).
        console.error(`the service is running (pid ${pid}): ask it instead, with Telegram /tick N or Plan now in the dashboard`)
        process.exit(1)
      }
      const service = new Service(cfg)
      service.ensureAgents()
      console.log(await service.tick(agentIndex(args[0]), undefined))
      return
    }
    case 'kill':
    case 'pause':
    case 'resume':
    case 'mode':
    case 'log': {
      const store = new Store(cfg.dataDir)
      if (cmd === 'kill') {
        if (args[0] !== 'on' && args[0] !== 'off') usage()
        store.setKillSwitch(args[0] === 'on')
        console.log(`kill switch ${args[0]} (a running service reads it before every action)`)
      } else if (cmd === 'pause' || cmd === 'resume') {
        const n = agentIndex(args[0])
        if (!store.agent(n)) throw new Error(`no ${agentName(n)}`)
        store.setPaused(n, cmd === 'pause')
        console.log(`${agentName(n)} ${cmd}d`)
      } else if (cmd === 'mode') {
        if (args[0] !== undefined && args[0] !== 'dry' && args[0] !== 'live') usage()
        if (args[0] === 'live' && !liveSigningAllowed()) throw new Error('live signing is not allowed on this server: set AGENT_LIVE_ENABLED=1 in its env file and restart')
        if (args[0]) {
          store.setLiveMode(args[0] === 'live')
          store.log({ agentIndex: null, kind: 'control', status: 'info', summary: `mode ${args[0] === 'live' ? 'LIVE' : 'dry run'} (CLI)` })
        }
        console.log(`mode ${store.liveMode ? 'LIVE' : 'dry run'} for all agents (a running service reads it before every action)`)
      } else {
        for (const r of store.activity(args[0] ? agentIndex(args[0]) : null, 30).reverse()) console.log(`${r.at.slice(0, 19)} ${r.agentIndex === null ? '-' : `a${r.agentIndex + 1}`} ${r.kind} [${r.status}] ${r.summary}`)
      }
      return
    }
    case 'configure': {
      const envFile = envFilePath()
      if (!process.stdin.isTTY) throw new Error('configure needs an interactive terminal (run it yourself over SSH)')
      console.log(`Writing to ${envFile}. Press Enter to keep a value unchanged. Nothing you type is shown.`)
      const values: Record<string, string> = {}
      const ask = async (key: string, label: string) => {
        const v = await promptHidden(`${label}: `)
        if (v) values[key] = v
      }
      await ask('ANTHROPIC_API_KEY', 'Anthropic API key (sk-ant-...)')
      await ask('TELEGRAM_BOT_TOKEN', 'Telegram bot token from @BotFather')
      const token = values.TELEGRAM_BOT_TOKEN ?? cfg.telegramToken
      if (token && !cfg.telegramChatId) {
        const name = await telegramMe(token)
        const code = String(randomInt(100_000, 1_000_000))
        console.log(`Telegram bot @${name}. From your own Telegram account, send it this code: ${code}   then press Enter here.`)
        await promptHidden('')
        const id = pickOwnerChat(await telegramRecentChats(token), code)
        if (id) {
          values.TELEGRAM_CHAT_ID = id
          console.log('Your chat was found and saved: your Telegram bot answers only you.')
        } else {
          console.log('The code was not found. Send exactly those digits to your Telegram bot, then run configure again.')
        }
      }
      await ask('BINANCE_API_KEY', 'Binance API key (withdraw-only, IP-restricted)')
      await ask('BINANCE_API_SECRET', 'Binance API secret')
      if (Object.keys(values).length) {
        setEnvValues(envFile, values, cfg.dataDir)
        // The env file is now the source for these keys: drop the web UI's overrides of them.
        writeSecrets(secretsFile(cfg.dataDir), Object.fromEntries(Object.keys(values).map(k => [k, ''])))
      }
      console.log(`Saved: ${Object.keys(values).join(', ') || 'nothing'}. Now run check-keys, then restart the service.`)
      return
    }
    case 'set-web-password': {
      if (!process.stdin.isTTY) throw new Error('set-web-password needs an interactive terminal')
      const rl = createInterface({ input: process.stdin, output: process.stdout })
      const username = (await rl.question(`Web UI username [${process.env.WEB_UI_USER ?? 'admin'}]: `)).trim() || process.env.WEB_UI_USER || 'admin'
      rl.close()
      if (!/^[A-Za-z0-9._-]{3,32}$/.test(username)) throw new Error('username: 3-32 letters, digits, dot, dash or underscore')
      const pw = await promptHidden('Password (at least 12 characters): ')
      if (pw.length < 12) throw new Error('password too short: use at least 12 characters')
      if ((await promptHidden('Repeat the password: ')) !== pw) throw new Error('the passwords differ; nothing saved')
      const values: Record<string, string> = { WEB_UI_USER: username, WEB_UI_PASSWORD_HASH: hashPassword(pw) }
      if (!process.env.WEB_UI_SECRET || process.env.WEB_UI_SECRET.length < 32) values.WEB_UI_SECRET = randomBytes(32).toString('hex')
      setEnvValues(envFilePath(), values, cfg.dataDir)
      console.log(`Saved the web UI login for "${username}" in ${envFilePath()}. Restart the service to apply it.`)
      return
    }
    case 'check-keys': {
      const checks = await checkKeys({
        ...cfg,
        ...strategistChoice(new Store(cfg.dataDir), cfg),
        binanceKey: process.env.BINANCE_API_KEY?.trim(),
        binanceSecret: process.env.BINANCE_API_SECRET?.trim(),
      })
      for (const c of checks) console.log(`${c.ok ? 'OK  ' : 'FAIL'}  ${c.text}`)
      if (cfg.mnemonic) console.log(`OK    agent 1 address: ${deriveWallet(cfg.mnemonic, 0).address} (whitelist this in Binance, network MultiversX/EGLD)`)
      return
    }
    default:
      usage()
  }
}

function parsePlan(json: string | undefined): PlannedAction[] {
  if (!json) usage()
  const raw = JSON.parse(json) as unknown
  return (Array.isArray(raw) ? raw : [raw]).map(a => ({ action: parseAction(a), reason: 'operator (CLI)' }))
}

/** The manual pages no list covers yet, and what to do about them. */
function undecidedText(pages: string[]): string {
  return [
    `NEW MANUAL PAGES, NOT DECIDED YET (${pages.length}):`,
    ...pages.map(p => `  ${p}`),
    'Read each one. A page with game rules goes into FOLDERS in src/strategist/manual.ts (and the condensed rules in',
    'prompt.ts and the checks in rules.ts if it changes play); any other page goes into LEFT_OUT there, with the reason.',
    'Then run sync-manual again.',
  ].join('\n')
}

/** An address-only wallet for simulations: it cannot sign anything. */
/** Match facts for one CLI run (snapshot, watch): nothing is written to the database. */
function memoryFacts(): MatchFactsCache {
  const kept = new Map<string, MatchFormations>()
  return { get: k => kept.get(k), put: (k, f) => void kept.set(k, f) }
}

/** Sales for one CLI run (snapshot, watch): nothing is written to the database. */
function memorySales(): MarketSalesCache {
  const kept = new Map<number, MarketSale>()
  let complete = false
  return { has: id => kept.has(id), put: rows => rows.forEach(r => kept.set(r.id, r)), since: iso => [...kept.values()].filter(r => r.sold_at >= iso), complete: () => complete, markComplete: () => { complete = true } }
}

function watchWallet(address: string): AgentWallet {
  const cannot = () => {
    throw new Error('watch wallet: no key (simulation only)')
  }
  return { index: 900, address, pubkeyHex: Address.newFromBech32(address).toHex(), shard: shardOf(address), signTransaction: cannot, signMessage: cannot }
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
