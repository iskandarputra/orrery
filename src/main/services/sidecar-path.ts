import { join } from 'node:path'
import { app } from 'electron'

/**
 * Where the Rust sidecar binary lives.
 *
 * Kept apart from `sidecar.ts` so that file imports no Electron and stays unit
 * testable — the same quarantine the other services observe.
 *
 * The dev and packaged locations differ because a packaged binary cannot live
 * inside the asar: an executable has to be a real file on disk, so
 * electron-builder copies it to `resources/` and it is found through
 * `process.resourcesPath`.
 */
export function sidecarPath(): string {
  const name = process.platform === 'win32' ? 'orrery-sidecar.exe' : 'orrery-sidecar'
  if (app.isPackaged) return join(process.resourcesPath, 'sidecar', name)
  // Not `app.getAppPath()`: for a dev run that is the *bundle* directory,
  // `out/main`, not the repo root — so the path resolved to a file that never
  // exists and the sidecar silently fell back forever. `__dirname` is the
  // bundle directory too, but it is honest about it, and `windows.ts` already
  // locates the preload script the same way.
  return join(__dirname, '..', '..', 'native', 'target', 'release', name)
}
