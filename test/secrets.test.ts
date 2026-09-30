import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applySecretOverrides, keyFormatError, maskKey, readSecrets, secretsFile, writeSecrets } from '../src/store/secrets.ts'

test('admin panel keys: mode 600 file, merged, emptied values removed, override the env', () => {
  const dir = mkdtempSync(join(tmpdir(), 'foxagent-'))
  const file = secretsFile(dir)
  assert.deepEqual(readSecrets(file), {})
  writeSecrets(file, { TELEGRAM_CHAT_ID: '123456789', BINANCE_API_KEY: 'a'.repeat(64) })
  writeSecrets(file, { BINANCE_API_KEY: '' })
  assert.deepEqual(readSecrets(file), { TELEGRAM_CHAT_ID: '123456789' })
  assert.equal(statSync(file).mode & 0o777, 0o600)
  const prev = process.env.TELEGRAM_CHAT_ID
  try {
    process.env.TELEGRAM_CHAT_ID = '111'
    applySecretOverrides(dir)
    assert.equal(process.env.TELEGRAM_CHAT_ID, '123456789')
  } finally {
    if (prev === undefined) delete process.env.TELEGRAM_CHAT_ID
    else process.env.TELEGRAM_CHAT_ID = prev
  }
})

test('key shapes are checked before saving; masks show enough to recognise a key', () => {
  assert.equal(keyFormatError('ANTHROPIC_API_KEY', 'sk-ant-api03-' + 'x'.repeat(40)), null)
  assert.match(keyFormatError('ANTHROPIC_API_KEY', 'sk-proj-abc')!, /sk-ant/)
  assert.match(keyFormatError('ANTHROPIC_API_KEY', 'sk-ant-api03-abc def')!, /spaces/)
  assert.equal(keyFormatError('TELEGRAM_BOT_TOKEN', '8123456789:AAH' + 'y'.repeat(32)), null)
  assert.match(keyFormatError('TELEGRAM_BOT_TOKEN', 'AAH' + 'y'.repeat(32))!, /BotFather/)
  assert.equal(keyFormatError('TELEGRAM_CHAT_ID', '-1001234567'), null)
  assert.match(keyFormatError('BINANCE_API_SECRET', 'short')!, /32 to 128/)
  assert.equal(maskKey('sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123', true), 'sk-ant-api…0123')
  assert.equal(maskKey('123456789', false), '123456789')
  assert.equal(maskKey('shortsecret', true), '••••')
  assert.equal(maskKey(undefined, true), '')
})
