import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCommand } from '../src/telegram/telegram.ts'

test('command parsing', () => {
  assert.deepEqual(parseCommand('/pause 0'), { command: 'pause', args: ['0'], rawArgs: '0' })
  assert.deepEqual(parseCommand('/status@FoxBot'), { command: 'status', args: [], rawArgs: '' })
  assert.equal(parseCommand('/ask 0 what should we train?')!.rawArgs, '0 what should we train?')
  assert.equal(parseCommand('hello'), null)
})

import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { binanceProblems, setEnvValues } from '../src/setup/keys.ts'

test('env values are replaced in place, file mode 600', () => {
  const f = join(mkdtempSync(join(tmpdir(), 'foxagent-')), 'env')
  writeFileSync(f, 'AGENT_MNEMONIC="a b"\nANTHROPIC_API_KEY="old"\n')
  setEnvValues(f, { ANTHROPIC_API_KEY: 'new', TELEGRAM_CHAT_ID: '42' })
  assert.equal(readFileSync(f, 'utf8'), 'AGENT_MNEMONIC="a b"\nANTHROPIC_API_KEY="new"\nTELEGRAM_CHAT_ID="42"\n')
  assert.equal(statSync(f).mode & 0o777, 0o600)
})

test('binance key must be withdraw-only and IP-locked', () => {
  assert.deepEqual(binanceProblems({ ipRestrict: true, enableReading: true, enableWithdrawals: true, enableSpotAndMarginTrading: false }), [])
  assert.equal(binanceProblems({ ipRestrict: false, enableReading: true, enableWithdrawals: true, enableSpotAndMarginTrading: true }).length, 2)
})
