// BEH-1: the "Plans are failing" alert is meant to come at most once an hour whatever number of agents hit the same
// account problem (service.ts tickFailed). Its once-an-hour memory is keyed by the whole error text, and Anthropic's
// 400 for a workspace usage limit carries a request_id that differs on every call, so every failed plan alerts again.
// Production: 28 such errors on 11 Nov (16:19 to 18:51 UTC) and 17 on 15 Nov (08:35 to 10:27 UTC), each its own text.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Mnemonic } from '@multiversx/sdk-core'
import Anthropic from '@anthropic-ai/sdk'
import type { Config } from '../../src/config.ts'
import { Service } from '../../src/service.ts'
import { describeModelError, isModelAccountError } from '../../src/strategist/strategist.ts'

function testConfig(dir: string): Config {
  return {
    mnemonic: Mnemonic.generate().toString(), dataDir: dir, gatewayUrl: 'http://127.0.0.1:9', apiUrl: 'http://127.0.0.1:9', foxleagueUrl: 'http://127.0.0.1:9',
    gatewayRps: 5, apiRps: 1, foxleagueRps: 5, anthropicApiKey: undefined, model: 'claude-sonnet-5', telegramToken: undefined, telegramChatId: undefined,
    isServer: false, defaultDryRun: true, maxAgents: 5,
  } as Config
}

/** The 400 Anthropic answered on 11 and 15 Nov, as the SDK builds it from the body: only the request id differs. */
const usageLimit = (requestId: string) =>
  Anthropic.APIError.generate(400, { type: 'error', error: { type: 'invalid_request_error', message: 'You have reached your specified workspace API usage limits. You will regain access on 2026-12-01 at 00:00 UTC.' }, request_id: requestId }, undefined, new Headers())

test('BEH-1: a workspace usage limit that stops every plan alerts the owner once an hour, not once per failed plan', () => {
  const svc = new Service(testConfig(mkdtempSync(join(tmpdir(), 'foxagent-beh1-'))))
  svc.ensureAgents()
  const urgent: string[] = []
  svc.notify = (t: string) => void urgent.push(t)
  svc.report = () => undefined
  const failed = (svc as unknown as { tickFailed: (i: number, e: unknown, m: string) => void }).tickFailed.bind(svc)
  // The request ids of the first five failed plans of 15 Nov (agents 5, 6, 10, 7, 2 within 25 minutes).
  const ids = ['req_011Ch4QaLMWaWPxjkoYYaTLh', 'req_011Ch4RM3Um6droKTv1vZDbs', 'req_011Ch4RNxK1JHSQavt8agXEz', 'req_011Ch4RRzoAK1AQKaLa8ujLC', 'req_011Ch4ST65oHF1a4ctys9cEr']
  ids.forEach((id, i) => {
    const err = usageLimit(id)
    assert.equal(isModelAccountError(err), true, 'it is an account problem')
    const msg = describeModelError(err)
    assert.match(msg, /^Anthropic API bad request: 400 .*workspace API usage limits.*request_id/, 'the text production logged')
    failed(i, err, msg)
  })
  assert.equal(urgent.length, 1, `one alert for the hour, whatever number of agents hit it; got ${urgent.length}`)
})
