// `npm test`: runs the test suite inside a temporary folder of its own and removes that folder afterwards (TMP-1).
//
// The tests make throwaway folders (homes, releases, stubs, installs) through os.tmpdir() and most never remove them:
// every run left hundreds in the system temp folder. On the maintainer's laptop repeated runs piled up more than
// 300,000 of them in /tmp; the clean of /tmp at boot then held up the start for almost 12 minutes (27 Nov 2026).
// TMPDIR, TMP and TEMP point at one folder per run, so every one of them (and the temp files of the shells the tests
// start) lands in a place that is removed in one go when the run passes, fails or is stopped.
//
// This file always runs; what the tests import is in test-runner.ts (R101A-1: a check of import.meta.main ran nothing
// and still exited 0 on a Node without it).
//
//   npm test                                     every test (test/**/*.test.ts)
//   npm test -- test/update.test.ts              some files
//   npm test -- --test-name-pattern=BUSY1        options for node --test; with no file named, every test
import { runTests } from './test-runner.ts'

process.exit(await runTests(process.argv.slice(2)))
