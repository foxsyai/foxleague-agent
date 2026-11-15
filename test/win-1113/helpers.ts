// Helpers of the tests of the Windows real-PC check of 2026-11-13 (test/win-1113/).
import { spawnSync } from 'node:child_process'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmp } from '../update-fixtures.ts'

/**
 * A tar that lists archives as the real one does and fails to unpack the way Ubuntu 26.04's tar fails inside a
 * service with RestrictSUIDSGID=true (or with the error given). It notes the LC_ALL it was started with.
 */
export function failingTar(error: string): { dir: string; lcAll: () => string } {
  const dir = tmp('fox-tar-')
  const real = spawnSync('bash', ['-c', 'command -v tar'], { encoding: 'utf8' }).stdout.trim()
  writeFileSync(
    join(dir, 'tar'),
    [
      '#!/usr/bin/env bash',
      `printf '%s\\n' "\${LC_ALL:-unset}" >> ${JSON.stringify(join(dir, 'lc_all'))}`,
      `case "$1" in -tzf | -tvzf) exec ${JSON.stringify(real)} "$@" ;; esac`,
      `printf '%s\\n' ${JSON.stringify(error)} >&2`,
      // Many more lines after the first ones, as on the PC (one or two for each of the 268 files).
      'for i in $(seq 1 300); do printf "/usr/bin/tar: foxleague-agent-v1.2.0/src/f%s.ts: Cannot open: No such file or directory\\n" "$i" >&2; done',
      'echo "/usr/bin/tar: Exiting with failure status due to previous errors" >&2',
      'exit 2',
      '',
    ].join('\n'),
  )
  chmodSync(join(dir, 'tar'), 0o755)
  return { dir, lcAll: () => readFileSync(join(dir, 'lc_all'), 'utf8') }
}

