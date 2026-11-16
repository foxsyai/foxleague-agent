// Audit 2026-11-16, ATTACK reviewer. ATK-3: a request line the URL parser refuses ("GET // HTTP/1.1", "//[", "//a b")
// is answered 500 before any sign-in is looked at, and each one writes "web UI error:" with a stack trace to the
// service's log. The nginx template passes the request line as the client sent it (proxy_pass without a path) and
// limits only /login, so anyone on the internet can write the agent's journal at will: journald then drops the
// service's own lines past its burst limit and rotates the older ones out (on macOS the file is cut once an hour).
// Right behaviour: a request the server cannot read is a client error (400 or 404), answered without a log line.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { raw, webService } from './web-helpers.ts'

test('ATK-3 a request line that is no URL is refused as the client\'s error, without a line in the service log', async () => {
  const { port, close } = await webService()
  const logged: string[] = []
  const error = console.error
  console.error = (...args: unknown[]) => void logged.push(args.map(String).join(' '))
  try {
    const answers: Record<string, number> = {}
    for (const path of ['//', '//[', '//a%20b:x']) answers[path] = (await raw(port, { method: 'GET', path })).status
    assert.ok(Object.values(answers).every(s => s >= 400 && s < 500), `nobody is signed in and the request is malformed: a 4xx, not an internal error (got ${JSON.stringify(answers)})`)
    assert.deepEqual(logged, [], `a stranger's malformed request must not write to the service log; it wrote ${logged.length} entries, the first: ${logged[0]?.slice(0, 160)}`)
  } finally {
    console.error = error
    close()
  }
})
