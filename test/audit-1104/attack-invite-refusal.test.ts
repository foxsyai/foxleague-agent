// Audit 2026-11-04 (five Fable 5.1 reviewers at max effort, PRs #29 to #50): the proof of a finding, failing before its fix.
// ATTACK candidate: FoxLeague's refusal of a League + Knockout invitation quotes the title of the tournament the team is
// "still in" (a title any player wrote). noticeInvitations sends it to the owner's Telegram with only C0 controls
// removed: Unicode format characters (bidi overrides and the like) pass and can reorder the owner's own message.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const W = new URL('../..', import.meta.url).pathname.replace(/\/$/, '')
const { snapshot } = await import(`${W}/test/fixtures.ts`)
const RLO = String.fromCharCode(0x202e) // RIGHT-TO-LEFT OVERRIDE, a Cf character

test('ATTACK-2: a bidi override in a rival\'s title reaches the owner\'s Telegram through the invitation refusal', async () => {
  const { Service } = await import(`${W}/src/service.ts`)
  const svc = new Service({
    mnemonic: 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about', dataDir: mkdtempSync(join(tmpdir(), 'foxagent-')),
    gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9', gatewayRps: 5, apiRps: 1, foxleagueRps: 5,
    anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined, isServer: false, defaultDryRun: true, maxAgents: 5,
  } as never)
  svc.ensureAgents()
  const sent: string[] = []
  svc.notify = (text: string) => { sent.push(text) }
  const s = snapshot()
  const rivalTitle = `Cup ${RLO}!ffo llik/ dnes :RENWO`
  s.auth!.invitations = [{
    tournament_id: 3001, title: 'Champions FoxLeague', tier: 'silver', entry_fee_foxsy: 1000, wave: 1,
    expires_at: new Date(Date.now() + 3600_000).toISOString(), seats_lock_at: new Date(Date.now() + 7200_000).toISOString(),
    can_accept: false, refusal: `still in ${rivalTitle}`, prize_atomic: null, tournament: null,
  }] as never
  await (svc as unknown as { noticeInvitations: (i: number, s: unknown) => Promise<void> }).noticeInvitations(0, s)
  assert.equal(sent.length, 1)
  assert.ok(!/\p{Cf}/u.test(sent[0]!), `a format character from the rival's title reached Telegram: ${JSON.stringify(sent[0])}`)
})
