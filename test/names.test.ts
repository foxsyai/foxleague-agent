import { test } from 'node:test'
import assert from 'node:assert/strict'
import { numberToIndex, agentName, pemName, whichAgents } from '../src/names.ts'

test('people count agents from 1, the code from 0', () => {
  assert.equal(agentName(0), 'agent 1')
  assert.equal(whichAgents([2]), 'agent 3')
  assert.equal(whichAgents([0, 2]), 'agents 1, 3')
  assert.equal(pemName(0), 'agent1.pem')
  assert.equal(numberToIndex('1'), 0)
  assert.equal(numberToIndex(3), 2)
  for (const bad of ['0', '-1', '1.5', 'x', '', undefined]) assert.equal(numberToIndex(bad), undefined, String(bad))
})
