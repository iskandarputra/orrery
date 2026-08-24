import { defineConfig } from '@playwright/test'

/**
 * E2E against the *built* Electron app (out/). Run `npm run build` first.
 * A single worker: the app is a stateful desktop process, not parallelizable.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure'
  }
})
