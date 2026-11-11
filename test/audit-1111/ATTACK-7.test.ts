// Audit 2026-11-11 (Fable 5.2 reviewers at extra-high effort): the proof of ATTACK-7, failing before its fix.
// The model writes the title of a tournament it creates, and the title is published to every FoxLeague player under
// the owner's team. A10 gave `register` a blocklist so a team name never imitates FoxLeague or its staff
// (actions.ts IMPERSONATION); the title of `create_tournament` had only a character check, and that check lets a
// domain name through (letters, digits, dot, hyphen). A plan steered by text another player wrote (the one thing the
// fence cannot rule out) could make the owner's team host "Official FoxLeague Support ..." with a link-like lure,
// paid for with the owner's seat and organizer deposit.
// Safe behaviour: a title that imitates FoxLeague or its staff is rejected by parseAction, as a team name is.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseAction } from '../../src/executor/actions.ts'

const create = (title: string) => ({ type: 'create_tournament', title, format: 'knockout', tier: 'silver', max_teams: 8, min_teams: 4, entry_fee_foxsy: 1000, starts_in_hours: 4, registration_closes_minutes_before: 30, round_interval_minutes: 60 })

test('ATTACK-7 a tournament title that imitates FoxLeague or its staff is refused, as a team name is', () => {
  // The rule that exists for team names (A10): the same words are refused there.
  assert.throws(() => parseAction({ type: 'register', team_name: 'FoxLeague Admin' }), /imitate/)
  // Ordinary titles still parse, a fox in the name included.
  for (const title of ['Friday Night Silver Cup', 'Fox Cup', 'Autumn Cup', 'Varna Cup', 'Silver 1v1 1000', 'Takers?', 'Modern Classics (best of 8)']) {
    assert.equal(parseAction(create(title)).type, 'create_tournament', title)
  }
  const lures = [
    'Official FoxLeague Support', 'FOXSY Admin refund - claim at fox-refunds.com', 'Team Fox staff giveaway', 'Moderator event, official prize',
    'Fox League Cup', 'fox-league finals', 'FOXLEAGUE', 'Support desk', 'Mods only', 'Staff picks',
  ]
  const accepted = lures.filter(title => {
    try {
      parseAction(create(title))
      return true
    } catch {
      return false
    }
  })
  assert.deepEqual(accepted, [], `these titles would be published under the owner's team: ${accepted.map(t => `"${t}"`).join(', ')}`)
  // The refusal says why, in the words of the team-name rule, so the next plan can pick another title.
  assert.throws(() => parseAction(create('Official FoxLeague Support')), /title must not imitate FoxLeague, FOXSY or its staff/)
})
