import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { LoginThrottle, Sessions, hashPassword, verifyPassword } from '../src/web/auth.ts'
import { validateSettingsPatch } from '../src/store/settings.ts'

test('scrypt hashes verify, reject wrong passwords and malformed hashes', () => {
  const h = hashPassword('correct horse battery')
  assert.match(h, /^scrypt\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/)
  assert.equal(verifyPassword('correct horse battery', h), true)
  assert.equal(verifyPassword('wrong', h), false)
  assert.equal(verifyPassword('x', 'bcrypt$a$b'), false)
  assert.equal(verifyPassword('x', 'garbage'), false)
})

test('hash format is interchangeable with the foxsy-trading Python scheme', () => {
  let py: string
  try {
    py = execFileSync('python3', ['-c', "import hashlib,base64;s=b'0123456789abcdef';d=hashlib.scrypt(b'pw-from-python',salt=s,n=2**15,r=8,p=1,dklen=32,maxmem=128*2**15*8*2);print('scrypt$'+base64.b64encode(s).decode()+'$'+base64.b64encode(d).decode())"]).toString().trim()
  } catch {
    return // no python3 here: nothing to compare against
  }
  assert.equal(verifyPassword('pw-from-python', py), true)
  assert.equal(hashPassword('pw-from-python', Buffer.from('0123456789abcdef')), py)
})

test('sessions: signed, expiring, tamper-proof; CSRF bound to the session', () => {
  const s = new Sessions('k'.repeat(64))
  const t = s.issue('admin')
  assert.equal(s.verify(t), 'admin')
  assert.equal(s.verify(t + 'x'), null)
  assert.equal(s.verify(new Sessions('z'.repeat(64)).issue('admin')), null)
  const forged = Buffer.from(JSON.stringify({ u: 'admin', exp: 9e9 })).toString('base64url') + '.' + t.split('.')[1]
  assert.equal(s.verify(forged), null)
  assert.equal(s.verify(t, Date.now() + 13 * 3600_000), null)
  assert.equal(s.checkCsrf(t, s.csrfFor(t)), true)
  assert.equal(s.checkCsrf(t, s.csrfFor(s.issue('admin'))), false)
  assert.equal(s.checkCsrf(t, undefined), false)
})

test('login throttle: lockout after 5 failures, doubling, success clears', () => {
  const th = new LoginThrottle()
  const now = 1_000_000
  for (let i = 0; i < 4; i++) th.recordFailure('1.2.3.4', now)
  assert.equal(th.check('1.2.3.4', now).ok, true)
  th.recordFailure('1.2.3.4', now)
  assert.deepEqual(th.check('1.2.3.4', now), { ok: false, waitS: 30 })
  th.recordFailure('1.2.3.4', now)
  assert.equal(th.check('1.2.3.4', now).waitS, 60)
  assert.equal(th.check('5.6.7.8', now).ok, true)
  th.recordSuccess('1.2.3.4')
  assert.equal(th.check('1.2.3.4', now).ok, true)
})

test('settings from the web UI are validated field by field', () => {
  assert.deepEqual(validateSettingsPatch({ dailyCapUsd: 12.5, entryFeesSilver: [2000, 1000, 2000] }), { dailyCapUsd: 12.5, entryFeesSilver: [1000, 2000] })
  assert.throws(() => validateSettingsPatch({ dailyCapUsd: -1 }), /dailyCapUsd/)
  assert.throws(() => validateSettingsPatch({ entryFeesSilver: [1246.5] }), /entryFeesSilver/)
  assert.throws(() => validateSettingsPatch({ entryFeesSilver: [5000] }), /entryFeesSilver/)
  assert.throws(() => validateSettingsPatch({ hacker: 1 }), /unknown setting/)
  assert.throws(() => validateSettingsPatch({ egldGasReserve: '1e3' }), /egldGasReserve/)
  assert.throws(() => validateSettingsPatch({ activeHoursUtc: [6, 6] }), /activeHoursUtc/)
})
