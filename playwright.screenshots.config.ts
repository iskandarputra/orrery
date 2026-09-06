import { defineConfig } from '@playwright/test'

/**
 * The README screenshots, which are generated rather than taken by hand.
 *
 * A config of its own because the generator cannot live in `e2e/`: it writes
 * into the working tree, and a suite that dirties the repository on every CI
 * run is a suite people learn to ignore. Playwright has no `--testDir` flag, so
 * pointing at the folder from the command line does not work, and the
 * instruction that used to be written at the top of the generator could never
 * have run. That is why the pictures went eighty-nine commits out of date
 * without anyone noticing.
 *
 *   ./orrery.sh shots
 *
 * Everything else is the e2e config: the same built app in `out/`, one worker,
 * and the same global setup, which is what refuses a run that would throw
 * windows onto a desktop somebody is working on.
 */
export default defineConfig({
  testDir: './scripts/screenshots',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure'
  }
})
