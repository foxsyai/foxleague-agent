// INSTALL-18 (macOS): the launchd agent sends the service's output to data/service.log, and nothing ever cut that
// file: not the plist, not the service, not the installer. It only grew, and a service that kept crashing added
// its stack trace every few seconds. Safe: at its start (and once an hour) the service keeps the file bounded:
// over 5 MB it keeps the last 1 MB, cut in place and never renamed, because launchd holds the file open.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, writeFileSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import { SERVICE_LOG_KEEP_BYTES, SERVICE_LOG_MAX_BYTES, boundServiceLog, keepServiceLogBounded } from '../../src/service-log.ts'
import { REPO, tmp } from './install-helpers.ts'

/** A log of numbered lines, at least `bytes` long. */
function lines(bytes: number): string {
  const out: string[] = []
  let size = 0
  for (let n = 1; size < bytes; n++) {
    const line = `2026-11-11T10:00:00Z line ${n} of the service's output, as long as a usual one is\n`
    out.push(line)
    size += line.length
  }
  return out.join('')
}

test('INSTALL-18: a service log over 5 MB keeps its last 1 MB, cut in place', () => {
  assert.equal(SERVICE_LOG_MAX_BYTES, 5 * 1024 * 1024)
  assert.equal(SERVICE_LOG_KEEP_BYTES, 1024 * 1024)
  const file = join(tmp(), 'service.log')
  const before = lines(SERVICE_LOG_MAX_BYTES + 300_000)
  writeFileSync(file, before)
  const inode = statSync(file).ino
  // launchd's side: the file is held open for appending the whole time.
  const held = openSync(file, 'a')
  try {
    const cut = boundServiceLog(file)
    const after = readFileSync(file, 'utf8')
    assert.ok(cut > 4 * 1024 * 1024, `about 4.3 MB were cut (${cut} bytes)`)
    assert.equal(before.length - cut, after.length)
    assert.ok(after.length <= SERVICE_LOG_KEEP_BYTES + 200 && after.length > SERVICE_LOG_KEEP_BYTES - 200, `about 1 MB is left (${after.length} bytes)`)
    assert.equal(statSync(file).ino, inode, 'the same file, not a new one under the old name')
    const [note, ...kept] = after.split('\n')
    assert.match(note!, /^\[foxleague-agent\] this log grew past 5 MB: only its last lines were kept \(\d{4}-\d\d-\d\dT[\d:.]+Z\)$/)
    assert.match(kept[0]!, /^2026-11-11T10:00:00Z line \d+ of the service's output/, 'what is kept starts at the start of a line')
    assert.ok(before.endsWith(kept.join('\n')), 'and is the end of the log, byte for byte')
    // What the service prints next lands right after it: no gap of empty bytes where the old end was.
    writeSync(held, 'the next line of output\n')
    const now = readFileSync(file)
    assert.equal(now.length, after.length + 'the next line of output\n'.length)
    assert.ok(now.toString('utf8').endsWith(`${kept[kept.length - 2]}\nthe next line of output\n`))
    assert.equal(now.includes(0), false, 'no NUL bytes')
    // A second look right away has nothing to do.
    assert.equal(boundServiceLog(file), 0)
  } finally {
    closeSync(held)
  }
})

test('INSTALL-18: a log at or under the limit, a missing one and something that is not a file are left alone', () => {
  const dir = tmp()
  const file = join(dir, 'service.log')
  const small = lines(200_000)
  writeFileSync(file, small)
  assert.equal(boundServiceLog(file), 0)
  assert.equal(readFileSync(file, 'utf8'), small)
  // The limits can be given (the test of the edge needs no 5 MB file).
  writeFileSync(file, 'x'.repeat(1000))
  assert.equal(boundServiceLog(file, { maxBytes: 1000, keepBytes: 100 }), 0, 'exactly at the limit')
  writeFileSync(file, 'x'.repeat(1001))
  assert.ok(boundServiceLog(file, { maxBytes: 1000, keepBytes: 100 }) > 0, 'one byte over')
  assert.ok(statSync(file).size <= 100 + 200)
  // One long line with no line end in what would be kept: the tail is kept as it is.
  assert.match(readFileSync(file, 'utf8'), /^\[foxleague-agent\] this log grew past [^\n]+\nx{100}$/)
  assert.equal(boundServiceLog(join(dir, 'not-there.log')), 0)
  assert.equal(existsSync(join(dir, 'not-there.log')), false, 'a missing log is not created')
  mkdirSync(join(dir, 'a-folder.log'))
  assert.equal(boundServiceLog(join(dir, 'a-folder.log')), 0, 'never an error: a log must not stop the service')
})

test('INSTALL-18: the service bounds data/service.log at its start, the file the launchd agent writes', () => {
  const data = tmp()
  writeFileSync(join(data, 'service.log'), lines(SERVICE_LOG_MAX_BYTES + 1000))
  const timer = keepServiceLogBounded(data)
  try {
    assert.ok(statSync(join(data, 'service.log')).size <= SERVICE_LOG_KEEP_BYTES + 200, 'cut at once')
    assert.equal(timer.hasRef(), false, 'the hourly look does not keep the process alive')
  } finally {
    clearInterval(timer)
  }
  const service = readFileSync(join(REPO, 'src', 'service.ts'), 'utf8')
  const main = service.slice(service.lastIndexOf('if (import.meta.main) {'))
  assert.equal((main.match(/keepServiceLogBounded\(/g) ?? []).length, 1, 'one call, in the block that starts the service')
  assert.equal((service.match(/keepServiceLogBounded\(/g) ?? []).length, 1)
  assert.ok(main.indexOf('keepServiceLogBounded(') < main.indexOf('service.start()'), 'before the service starts')
  assert.match(readFileSync(join(REPO, 'install.sh'), 'utf8'), /<key>StandardOutPath<\/key><string>\$DATA_DIR\/service\.log<\/string>/)
})
