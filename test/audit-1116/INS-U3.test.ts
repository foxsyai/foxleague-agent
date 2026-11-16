// INS-U3 (unproven item U3 of the INSTALL review of 16 Nov 2026): the virtualization tip of the Windows page and
// INSTALL.md says that `systeminfo` shows "Virtualization Enabled In Firmware: Yes" once virtualization is on. Where a
// hypervisor already runs (Windows 11 starts one for its own security features as soon as virtualization is on, and
// WSL 2 or Hyper-V start one too) systeminfo prints none of its "Hyper-V Requirements" lines but "A hypervisor has been
// detected. Features required for Hyper-V will not be displayed.": the owner who turned it on looks for a line that is
// not there and may think it is still off. Task Manager's "Virtualization: Enabled" is right in both cases.
// Right: the tip says that the hypervisor line means it is on too.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { REPO } from '../update-fixtures.ts'
import { join } from 'node:path'

const flat = (f: string): string => readFileSync(join(REPO, f), 'utf8').replace(/\s+/g, ' ')

test('INS-U3: the virtualization tip says what systeminfo shows when a hypervisor already runs', () => {
  for (const f of ['site/src/content/docs/start/install-windows.mdx', 'INSTALL.md']) {
    const text = flat(f)
    assert.match(text, /`systeminfo` shows "Virtualization Enabled In Firmware: Yes"/, `${f}: the tip is there`)
    assert.match(text, /"A hypervisor has been detected[^"]*"[^.]*(on|enabled) too/i, `${f} does not say that systeminfo's hypervisor line means virtualization is on`)
    assert.match(text, /Task Manager shows it too \(Performance, CPU/, `${f}: Task Manager's tip stays`)
  }
})
