// ATK-1 (pre-release audit 2026-11-22, ATTACK): a request whose body is cut short ended as a 500 with a stack trace in
// the service log. POST /login reads its body before any password is weighed, so anyone who reaches the port itself
// (not through nginx, which buffers the body first) could write "web UI error: Error: aborted" plus its stack once a
// request, and the login lockout never counted it. Same class as ATK-3 of 16 Nov (a bad request line).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { connect } from 'node:net'
import { webService } from '../audit-1116/web-helpers.ts'

const cut = (port: number): Promise<void> => new Promise(resolve => {
  const c = connect(port, '127.0.0.1', () => {
    c.write(`POST /login HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: 200\r\n\r\nusername=a`)
    setTimeout(() => {
      c.destroy()
      setTimeout(resolve, 80)
    }, 30)
  })
})

test('ATK-1 a login whose body is cut short writes nothing to the service log', async () => {
  const s = await webService()
  const logged: string[] = []
  const real = console.error
  console.error = (...a: unknown[]) => { logged.push(a.map(x => (x instanceof Error ? `${x.stack}` : String(x))).join(' ')) }
  try {
    for (let i = 0; i < 3; i++) await cut(s.port)
  } finally {
    console.error = real
  }
  // Control: the server still answers a whole request (a wrong password is a 401, nothing logged as an error).
  const r = await fetch(`${s.url}/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'username=admin&password=wrong' })
  s.close()
  assert.deepEqual(logged, [], 'a cut body must end as a 400 (not logged), never a 500 with a stack trace')
  assert.equal(r.status, 401)
})
