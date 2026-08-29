import { readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Refuse to open real windows on someone's desktop.
 *
 * The suite drives a real Electron app, so running it outside a virtual display
 * throws windows onto whatever screen you are working on, steals focus, and
 * does it once per spec file. Wrapping the runner in xvfb fixes that, and then
 * one `npx playwright test` typed out of habit undoes it again.
 *
 * So the wrappers mark themselves, and running without one stops here with the
 * command that would have worked.
 */
/**
 * Sweep temporary vaults left by earlier runs.
 *
 * Every spec makes a vault under the system temp directory and removes it in
 * `afterAll`, which does not run when a worker crashes or a run is killed. Each
 * leak is small; five gigabytes of them filled /tmp and Electron began failing
 * to start with "Disk quota exceeded" from its font service, which looks like
 * anything except a full disk.
 *
 * Only this project's own directories, and only ones old enough that no live
 * run could still be using them.
 */
function sweepStaleVaults(): void {
  const root = tmpdir()
  const hourAgo = Date.now() - 60 * 60 * 1000
  let names: string[]
  try {
    names = readdirSync(root)
  } catch {
    return
  }
  for (const name of names) {
    if (!name.startsWith('orrery-')) continue
    const path = join(root, name)
    try {
      if (statSync(path).mtimeMs > hourAgo) continue
      rmSync(path, { recursive: true, force: true })
    } catch {
      // Someone else's, or already gone. Neither is worth stopping for.
    }
  }
}

export default function globalSetup(): void {
  sweepStaleVaults()

  const wrapped = process.env['ORRERY_E2E_WRAPPED'] === '1'
  const headed = process.env['ORRERY_HEADED'] === '1'
  const hasDisplay = Boolean(process.env['DISPLAY'] || process.env['WAYLAND_DISPLAY'])

  if (wrapped || headed || !hasDisplay) return

  throw new Error(
    [
      '',
      'Refusing to open Electron windows on your display.',
      '',
      '  ./orrery.sh e2e            all of it',
      '  npm run e2e:run -- <spec>  one file',
      '  ORRERY_HEADED=1 ...        when watching them is the point',
      ''
    ].join('\n')
  )
}
