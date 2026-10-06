import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Address } from '@multiversx/sdk-core'
import { Store } from '../src/store/db.ts'
import { MAINNET } from '../src/config.ts'
import { Executor } from '../src/executor/executor.ts'
import { gameDayKey } from '../src/executor/budget.ts'
import type { AgentSnapshot, PlayerView } from '../src/snapshot/snapshot.ts'
import type { Chain } from '../src/chain/gateway.ts'
import type { FoxLeague } from '../src/foxleague/api.ts'
import type { Config } from '../src/config.ts'
import type { AgentWallet } from '../src/wallet/wallet.ts'
import { decimalToAtomic, hexOfString, numberToHex, wholeToAtomic } from '../src/util/encoding.ts'
import { liveWallet, withLive } from './fixtures.ts'

const ADDR = 'erd1fdp7wx5sspwft8jqhp44wlgjyqgjyj229yzfukdpas3g7gkhh32qcr4rpl'
const wallet: AgentWallet = { index: 0, address: ADDR, pubkeyHex: '00', shard: 0, signTransaction: () => assert.fail('must not sign in dry run'), signMessage: () => assert.fail('must not sign') }

function player(nonce: number, position: PlayerView['position'], role: PlayerView['role'], slot?: number): PlayerView {
  const stats = { speed: 20, accuracy: 20, defense: 20, power: 20, control: 20, vision: 20, stamina: 20 }
  return { nonce, name: `P${nonce}`, position, rarity: 'Common', cap: 30, role, ...(slot !== undefined ? { slot } : {}), condition: 100, ageYears: 18, synced: { ...stats }, live: { ...stats }, xp: {}, dirty: false, competitiveMatches: 0, fusionMatchCredit: 0, fusionReadyAt: null, listed: false, transferLockedUntil: null, syncedTotal: 140 }
}

function snapshot(): AgentSnapshot {
  // 4-4-2: GK, 4 DEF, 4 MID, 2 FWD; bench 7.
  const positions: PlayerView['position'][] = ['GK', 'DEF', 'DEF', 'DEF', 'DEF', 'MID', 'MID', 'MID', 'MID', 'FWD', 'FWD']
  const players = positions.map((p, i) => player(i + 1, p, 'starter', i))
  const bench: PlayerView['position'][] = ['GK', 'DEF', 'DEF', 'MID', 'MID', 'FWD', 'FWD']
  bench.forEach((p, i) => players.push(player(20 + i, p, 'bench')))
  return {
    takenAt: new Date().toISOString(),
    watchOnly: false,
    agent: { index: 0, address: ADDR, shard: 0 },
    gameDay: { resetHourUtc: 14, nextResetAt: '', hoursToReset: 5 },
    chain: { egld: wholeToAtomic(10), nonce: 1, foxsy: wholeToAtomic(10_000), wegld: 0n, nftCount: 18 },
    prices: { egldUsd: 4.5, egldPerFoxsy: 0.0005, foxsyUsd: 0.00225 },
    config: {
      registration_fee_foxsy: 5000, registration_fee_wei: wholeToAtomic(5000).toString(), relayer_v3_enabled: true, relays_remaining_today: 5000, relayer_addresses: [],
      dex_swap_enabled: true, shop_prices_foxsy: { condition: 100, xp_booster: 2000, training: 20 }, common_pack_price_foxsy: 2500, common_pack_available: true, sync_cost_foxsy: 10,
      tournament_fee_bounds: { silver_min: 1000, silver_max: 5000, gold_min: 5000 }, tournament_prize_split: { winner_percent: 45, runner_up_percent: 30, third_percent: 15, platform_fee_percent: 10 },
      one_v_one_prize_split: { winner_percent: 90, platform_fee_percent: 10 },
      tournament_defaults: { match_stagger_minutes: 15, deadline_grace_minutes: 30, knockout_min_participants: 2, swiss_min_participants: 3, groups_knockout_group_size: 4, one_v_one_max_active_per_user: 1, one_v_one_prize_delivery_seconds: 180 },
      min_field_condition: 30, condition_regen_points_per_day: 48, condition_loss_per_match: 10, condition_loss_per_match_ranked: 5, fusion_costs_foxsy: [100, 200, 400, 800], auction_enabled: true, foxsy_token_id: 'FOXSY-5d5f3e',
    },
    registration: { registered: true, teamName: 'Agent', feePaidOnChain: true, whitelisted: true, relayerEnabled: true, relaysRemaining: 5000, starterStock: 100 },
    profile: { id: 100, wallet_address: ADDR, username: null, elo_rating: 1200, league: 'Bronze', matches_won: 0, matches_lost: 0, matches_drawn: 0, team_name: 'Agent', badge: null, verified: false, tournament_wins: 0, active_title: null, player_count: 18 },
    team: { id: 1, user_id: 100, name: 'Agent', coach_name: null, formation: '4-4-2', lineup: players.slice(0, 11).map(p => p.nonce), substitutes: players.slice(11).map(p => p.nonce), team_overall: 20, badge: null },
    players,
    auth: {
      shop: { training: { daily_free: 5, premium_cap: 10, used_today: 0, premium_used_today: 0, slots_banked: 0 } },
      allowance: { today_count: 0, daily_limit: 5, reset_hour_utc: 14 },
      activeMatch: null,
      myTournaments: { active: [], completed: [] },
      upcoming: { lead_minutes: 30, my_team_name: 'Agent', matches: [] },
      challengesForMe: [],
    },
    market: { openStandard: [], openChallenges: [], recentStandard: [], slots: [], auctions: [], floors: [] },
    leaderboardNeighbours: [],
    warnings: [],
  }
}

function setup() {
  const store = new Store('', ':memory:')
  store.addAgent(0, ADDR)
  const chain = { simulate: async () => ({ ok: true, detail: 'success', raw: {} }) } as unknown as Chain
  const fox = { user: async () => null, tournament: async () => { throw new Error('no network in tests') } } as unknown as FoxLeague
  const exec = new Executor({ cfg: {} as Config, chain, fox, store })
  return { store, exec, agent: () => store.agent(0)! }
}

test('API-only actions dry-run without signing and without spend', async () => {
  const { exec, agent, store } = setup()
  const [r] = await exec.run(agent(), wallet, snapshot(), [{ action: { type: 'train', player_nonce: 2, attribute: 'defense' }, reason: 't' }])
  assert.equal(r!.status, 'dry_run')
  assert.match(r!.summary, /POST \/api\/training\/train/)
  assert.equal(store.spentUsd(0, { category: 'play', dryRun: true }), 0)
})

test('kill switch and pause refuse everything', async () => {
  const { exec, agent, store } = setup()
  store.setKillSwitch(true)
  const [a] = await exec.run(agent(), wallet, snapshot(), [{ action: { type: 'sync' }, reason: '' }])
  assert.match(a!.summary, /kill switch/)
  store.setKillSwitch(false)
  store.setPaused(0, true)
  const [b] = await exec.run(agent(), wallet, snapshot(), [{ action: { type: 'play_match', match_type: 'casual' }, reason: '' }])
  assert.match(b!.summary, /paused/)
})

test('daily cap: a second booster the same game day is refused', async () => {
  const { exec, agent, store } = setup()
  store.updateSettings(0, { dailyCapUsd: 5, maxShopPaymentFoxsy: 2500 })
  const first = await exec.run(agent(), wallet, snapshot(), [{ action: { type: 'buy', product: 'xp_booster' }, reason: '' }])
  assert.equal(first[0]!.status, 'dry_run') // 2,000 FOXSY at $0.00225 = $4.50
  assert.ok(store.spentUsd(0, { category: 'play', dryRun: true, gameDay: gameDayKey(new Date()) }) > 4.4)
  const second = await exec.run(agent(), wallet, snapshot(), [{ action: { type: 'buy', product: 'training_slot', quantity: 25 }, reason: '' }])
  assert.equal(second[0]!.status, 'refused')
  assert.match(second[0]!.summary, /daily cap/)
  // The live ledger is separate: dry-run spend never blocks live spending.
  assert.equal(store.spentUsd(0, { category: 'play', dryRun: false }), 0)
})

test('lineup positions must follow the formation slots (the server does not check)', async () => {
  const { exec, agent } = setup()
  const s = snapshot()
  const lineup = [...s.team!.lineup]
  ;[lineup[1], lineup[5]] = [lineup[5]!, lineup[1]!] // a MID in a DEF slot
  const [r] = await exec.run(agent(), wallet, s, [{ action: { type: 'set_lineup', lineup, substitutes: s.team!.substitutes }, reason: '' }])
  assert.equal(r!.status, 'refused')
  assert.match(r!.summary, /slot 1 of 4-4-2 wants a DEF/)
})

test('plans see earlier effects: the 6th match of the day is refused', async () => {
  const { exec, agent } = setup()
  const s = snapshot()
  s.auth!.allowance!.today_count = 4
  const rs = await exec.run(agent(), wallet, s, [
    { action: { type: 'play_match', match_type: 'casual' }, reason: '' },
    { action: { type: 'play_match', match_type: 'casual' }, reason: '' },
  ])
  assert.equal(rs[0]!.status, 'dry_run')
  assert.equal(rs[1]!.status, 'refused')
})

test('registration refused while the whitelist gate is on', async () => {
  const { exec, agent } = setup()
  const s = snapshot()
  s.registration = { ...s.registration, registered: false, whitelisted: false, feePaidOnChain: false }
  const [r] = await exec.run(agent(), wallet, s, [{ action: { type: 'register', team_name: 'Fox Agent' }, reason: '' }])
  assert.match(r!.summary, /not whitelisted/)
})

test('registration: FoxLeague is asked about the name before the fee; a taken, refused or unchecked name pays nothing', async () => {
  const { ApiRefusal } = await import('../src/foxleague/api.ts')
  const s = snapshot()
  s.registration = { ...s.registration, registered: false, feePaidOnChain: false }
  s.config!.relayer_addresses = [ADDR] // a relayer in the wallet's shard
  const register = { action: { type: 'register', team_name: 'Lyon Rovers' }, reason: '' } as const
  const run = async (answer: () => Promise<unknown>) => {
    const store = new Store('', ':memory:')
    store.addAgent(0, ADDR)
    const asked: string[] = []
    let simulated = 0
    const chain = { simulate: async () => (simulated++, { ok: true, detail: 'success', raw: {} }) } as unknown as Chain
    const fox = { user: async () => null, nameAvailable: async (_w: unknown, name: string) => (asked.push(name), answer()) } as unknown as FoxLeague
    const [r] = await new Executor({ cfg: {} as Config, chain, fox, store }).run(store.agent(0)!, wallet, s, [register])
    return { r: r!, asked, simulated, spent: store.spentUsd(0, { category: 'setup', dryRun: true }) }
  }

  const free = await run(async () => ({ available: true }))
  assert.deepEqual([free.r.status, free.asked, free.simulated], ['dry_run', ['Lyon Rovers'], 1])
  assert.ok(free.spent > 0, 'a free name goes on to the fee')

  const taken = await run(async () => { throw new ApiRefusal('That team name is already taken') })
  assert.equal(taken.r.status, 'refused')
  assert.match(taken.r.summary, /the name "Lyon Rovers" is taken \(FoxLeague checked it before any payment\); the next plan picks another/)
  assert.deepEqual([taken.simulated, taken.spent], [0, 0], 'nothing built, nothing booked')

  const format = await run(async () => { throw new ApiRefusal('Team name can only contain letters, numbers, spaces and hyphens') })
  assert.match(format.r.summary, /FoxLeague refuses the name "Lyon Rovers": Team name can only contain/)
  assert.equal(format.simulated, 0)

  const unchecked = await run(async () => { throw new Error('HTTP 500') })
  assert.equal(unchecked.r.status, 'refused')
  assert.match(unchecked.r.summary, /the name could not be checked \(HTTP 500\); nothing paid/)
  assert.equal(unchecked.simulated, 0, 'an unanswered check is never a free name')
})

test('gas reserve: fees may use it, a swap may not dip into it', async () => {
  const { exec, agent, store } = setup()
  store.updateSettings(0, { egldGasReserve: '0.05' })
  const at = (egld: string) => { const s = snapshot(); s.chain!.egld = decimalToAtomic(egld); return s }
  const slot = { action: { type: 'buy', product: 'training_slot', quantity: 1 }, reason: '' } as const
  const [onReserve] = await exec.run(agent(), wallet, at('0.05'), [slot])
  assert.equal(onReserve!.status, 'dry_run') // exactly the 0.05 reserve left: the fee is paid from it
  const [empty] = await exec.run(agent(), wallet, at('0'), [slot])
  assert.equal(empty!.status, 'refused')
  assert.match(empty!.summary, /for gas/)

  // Pool at 0.0005 EGLD per FOXSY: 1,000 FOXSY quote 0.5 EGLD, pays at most 0.505 (1%).
  const b64 = (n: bigint) => Buffer.from(numberToHex(n), 'hex').toString('base64')
  const answers: Record<string, string[]> = {
    getState: [b64(1n)],
    getFirstTokenId: [Buffer.from('FOXSY-5d5f3e').toString('base64')],
    getSecondTokenId: [Buffer.from('WEGLD-bd4d79').toString('base64')],
    getReservesAndTotalSupply: [b64(wholeToAtomic(1_000_000)), b64(wholeToAtomic(500)), b64(1n)],
    getAmountIn: [b64(wholeToAtomic(1) / 2n)],
  }
  ;(exec as unknown as { d: { chain: unknown } }).d.chain = {
    simulate: async () => ({ ok: true, detail: 'success', raw: {} }),
    query: async (_sc: string, fn: string) => answers[fn] ?? assert.fail(`unexpected query ${fn}`),
  }
  const swap = { action: { type: 'swap_egld_for_foxsy', foxsy: 1000 }, reason: '' } as const
  const [short] = await exec.run(agent(), wallet, at('0.55'), [swap])
  assert.equal(short!.status, 'refused') // 0.505 + fee + 0.05 reserve > 0.55
  assert.match(short!.summary, /gas reserve/)
  const [ok] = await exec.run(agent(), wallet, at('0.6'), [swap])
  assert.equal(ok!.status, 'dry_run')
})

test('WEGLD in the wallet is spent first, with no reserve, when it covers the whole swap; otherwise EGLD', async () => {
  const { exec, agent, store } = setup()
  store.updateSettings(0, { egldGasReserve: '1', dailyCapUsd: 50 })
  // Pool at 0.0005 EGLD per FOXSY: 1,000 FOXSY quote 0.5, pays at most 0.505 (1%).
  const b64 = (n: bigint) => Buffer.from(numberToHex(n), 'hex').toString('base64')
  const answers: Record<string, string[]> = {
    getState: [b64(1n)],
    getFirstTokenId: [Buffer.from('FOXSY-5d5f3e').toString('base64')],
    getSecondTokenId: [Buffer.from('WEGLD-bd4d79').toString('base64')],
    getReservesAndTotalSupply: [b64(wholeToAtomic(1_000_000)), b64(wholeToAtomic(500)), b64(1n)],
    getAmountIn: [b64(wholeToAtomic(1) / 2n)],
  }
  const sent: { receiver: string; value: string; data: string; gasLimit: number }[] = []
  ;(exec as unknown as { d: { chain: unknown } }).d.chain = {
    simulate: async (tx: { receiver: string; value: string; data: string; gasLimit: number }) => (sent.push(tx), { ok: true, detail: 'success', raw: {} }),
    query: async (_sc: string, fn: string) => answers[fn] ?? assert.fail(`unexpected query ${fn}`),
  }
  const at = (egld: string, wegld: string) => { const s = snapshot(); s.chain!.egld = decimalToAtomic(egld); s.chain!.wegld = decimalToAtomic(wegld); return s }
  const swap = { action: { type: 'swap_egld_for_foxsy', foxsy: 1000 }, reason: '' } as const
  const maxIn = decimalToAtomic('0.505')

  // Only the gas reserve in EGLD, but 0.6 WEGLD: the swap goes through the pair with WEGLD, nothing of the EGLD is sent.
  const [viaWegld] = await exec.run(agent(), wallet, at('1', '0.6'), [swap])
  assert.equal(viaWegld!.status, 'dry_run')
  assert.match(viaWegld!.summary, /quote 0\.5000 WEGLD from the wallet, pays at most 0\.5050 WEGLD/)
  const tx = sent.at(-1)!
  assert.equal(tx.receiver, MAINNET.foxsyWegldPair)
  assert.equal(BigInt(tx.value), 0n)
  assert.equal(Buffer.from(tx.data, 'base64').toString(), `ESDTTransfer@${hexOfString('WEGLD-bd4d79')}@${numberToHex(maxIn)}@${hexOfString('swapTokensFixedOutput')}@${hexOfString('FOXSY-5d5f3e')}@${numberToHex(wholeToAtomic(1000))}`)
  assert.equal(Number(tx.gasLimit), 24_000_000)

  // Too little WEGLD for the whole swap: the EGLD path, and with EGLD at the reserve it is refused as before.
  const [short] = await exec.run(agent(), wallet, at('1', '0.5'), [swap])
  assert.equal(short!.status, 'refused')
  assert.match(short!.summary, /gas reserve/)
  const [viaEgld] = await exec.run(agent(), wallet, at('2', '0.5'), [swap])
  assert.equal(viaEgld!.status, 'dry_run')
  assert.equal(sent.at(-1)!.receiver, MAINNET.composableTasks)
  assert.equal(BigInt(sent.at(-1)!.value), maxIn)

  // Two swaps in one plan: the first takes the WEGLD, the second sees it gone and uses EGLD.
  const before = sent.length
  const both = await exec.run(agent(), wallet, at('3', '0.6'), [swap, swap])
  assert.deepEqual(both.map(r => r.status), ['dry_run', 'dry_run'])
  assert.deepEqual(sent.slice(before).map(t => t.receiver), [MAINNET.foxsyWegldPair, MAINNET.composableTasks])

  // Live: one transaction to the pair, booked against the swap allowance, and the result names the coin that paid.
  const live: { receiver: string; value: string }[] = []
  Object.assign((exec as unknown as { d: { chain: Record<string, unknown> } }).d.chain, {
    account: async () => ({ nonce: 1, balance: wholeToAtomic(1) }),
    send: async (tx: { receiver: string; value: string }) => (live.push(tx), 'hashswap'),
    waitForOutcome: async () => ({ kind: 'success' }),
  })
  await withLive(store, async () => {
    const [paidWegld] = await exec.run(agent(), liveWallet, at('1', '0.6'), [swap])
    assert.equal(paidWegld!.status, 'confirmed', paidWegld!.summary)
    assert.match(paidWegld!.summary, /swap EGLD for 1000 FOXSY: done, paid with WEGLD from the wallet \(at most 0\.5050\)/)
    const [paidEgld] = await exec.run(agent(), liveWallet, at('3', '0'), [swap])
    assert.match(paidEgld!.summary, /done, paid with EGLD \(at most 0\.5050\)/)
  })
  assert.deepEqual(live.map(t => [t.receiver, BigInt(t.value)]), [[MAINNET.foxsyWegldPair, 0n], [MAINNET.composableTasks, maxIn]])
  assert.ok(Math.abs(store.spentUsd(0, { category: 'swap', dryRun: false }) - 2 * 0.505 * 4.5) < 0.01, 'both swaps count against the swap allowance at what they may pay')

  // A WEGLD swap still needs EGLD for its fee, and still counts against the daily swap allowance.
  const [noGas] = await exec.run(agent(), wallet, at('0', '0.6'), [swap])
  assert.equal(noGas!.status, 'refused')
  assert.match(noGas!.summary, /for gas/)
  store.updateSettings(0, { dailyCapUsd: 1 })
  const [capped] = await exec.run(agent(), wallet, at('1', '0.6'), [swap])
  assert.equal(capped!.status, 'refused')
  assert.match(capped!.summary, /daily cap|daily swap allowance/)
})

test('one mode for all agents: live needs the platform switch AND the server permission', async () => {
  const { exec, agent, store } = setup()
  store.addAgent(1, 'erd1qyu5wthldzr8wx5c9ucg8kjagg0jfs53s8nr3zpz3hypefsdd8ssycr6th')
  assert.equal(store.liveMode, false)
  assert.ok(store.agents().every(b => b.dryRun)) // dry run by default
  store.setLiveMode(true)
  assert.ok(store.agents().every(b => !b.dryRun))

  const trained: number[] = []
  ;(exec as unknown as { d: { fox: unknown } }).d.fox = { user: async () => null, train: async (_w: unknown, nonce: number) => void trained.push(nonce) }
  const train = { action: { type: 'train', player_nonce: 2, attribute: 'defense' }, reason: '' } as const
  const prev = process.env.AGENT_LIVE_ENABLED
  try {
    delete process.env.AGENT_LIVE_ENABLED
    const [held] = await exec.run(agent(), wallet, snapshot(), [train])
    assert.equal(held!.status, 'dry_run') // live mode, but the server does not allow signing
    process.env.AGENT_LIVE_ENABLED = '1'
    const [live] = await exec.run(agent(), wallet, snapshot(), [train])
    assert.equal(live!.status, 'confirmed')
    assert.deepEqual(trained, [2])
    store.setLiveMode(false)
    const [back] = await exec.run(agent(), wallet, snapshot(), [train])
    assert.equal(back!.status, 'dry_run')
    assert.deepEqual(trained, [2])
  } finally {
    if (prev === undefined) delete process.env.AGENT_LIVE_ENABLED
    else process.env.AGENT_LIVE_ENABLED = prev
  }
})

test('sync: the payload targets the players contract, the transaction goes to the agent itself', async () => {
  const { exec, agent } = setup()
  const s = snapshot()
  s.players[1]!.dirty = true
  const playersHex = Address.newFromBech32(MAINNET.playersContract).toHex()
  const sent: { receiver: string; data: string }[] = []
  let prep = { sc_call_data: `MultiESDTNFTTransfer@${playersHex}@02@464f5853592d356435663365@00@8ac7230489e80000@46584c502d366632386535@02@01@73796e634d795374617473@${'00'.repeat(8)}`, receiver: MAINNET.playersContract as string, gas_limit: 18_000_000, foxsy_cost: '10000000000000000000', nonces: [2], player_count: 1, wait_seconds: 0 }
  const d = exec as unknown as { d: { chain: unknown; fox: unknown } }
  d.d.chain = { simulate: async (tx: { receiver: string; data: string }) => (sent.push(tx), { ok: true, detail: 'success', raw: {} }) }
  d.d.fox = { user: async () => null, syncPrepare: async () => prep }
  const [ok] = await exec.run(agent(), wallet, s, [{ action: { type: 'sync' }, reason: '' }])
  assert.equal(ok!.status, 'dry_run')
  assert.equal(sent[0]!.receiver, ADDR)
  assert.equal(Buffer.from(sent[0]!.data, 'base64').toString(), prep.sc_call_data)

  prep = { ...prep, receiver: 'erd1qqqqqqqqqqqqqpgq5jnjpsukhl295ry3wjrd3gtff0amrgux2jpsz3reum' }
  const [wrong] = await exec.run(agent(), wallet, s, [{ action: { type: 'sync' }, reason: '' }])
  assert.equal(wrong!.status, 'error')
  assert.match(wrong!.summary, /not the players contract/)
})

test('a formation FoxLeague lists as coming soon is not offered: 4-4-2a is refused before the executor sees it', async () => {
  const { parseAction, FORMATION_SLOTS } = await import('../src/executor/actions.ts')
  assert.throws(() => parseAction({ type: 'set_formation', formation: '4-4-2a' }), /formation/)
  assert.deepEqual(parseAction({ type: 'set_formation', formation: '4-4-2o' }), { type: 'set_formation', formation: '4-4-2o' })
  assert.ok(FORMATION_SLOTS['4-4-2a'], 'its slots stay known for a team that saved it earlier')
})
