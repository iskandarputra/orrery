import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, expect } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'

const userDataDirs: string[] = []

// Each worker cleans up after the specs it ran.
process.on('exit', () => {
  for (const dir of userDataDirs) rmSync(dir, { recursive: true, force: true })
})

/**
 * The environment the app is launched into, with the display pinned to X11.
 *
 * Electron 36 and later default `--ozone-platform-hint` to `auto`, which means
 * "use Wayland if `WAYLAND_DISPLAY` is set". On a Wayland desktop — which is
 * every current Ubuntu and Fedora — that variable is set, and it is inherited
 * by the app however the suite is started. So the app connected to the real
 * compositor and the `DISPLAY=:99` that xvfb-run had just set was ignored:
 * every window opened on the desktop of whoever was working on the machine,
 * once per spec file, exactly as if xvfb were not there at all.
 *
 * It also broke the fallback. A window is parked at -20000,-20000 so that it
 * cannot be seen even when it is shown, and positioning your own window is
 * something only an X11 client can do — under Wayland the compositor decides,
 * so the window landed in the middle of the screen and took the keyboard.
 *
 * Both are fixed by refusing Wayland outright: the hint is pinned, the switch
 * is passed as well because a command line beats an environment variable, and
 * `WAYLAND_DISPLAY` is removed so there is nothing left to find. X11 is then
 * the only option, `DISPLAY` is honoured, and under xvfb-run that is the
 * virtual server.
 */
export function launchEnv(extra: Record<string, string> = {}): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value
  }
  delete env['WAYLAND_DISPLAY']
  return {
    ...env,
    ELECTRON_OZONE_PLATFORM_HINT: 'x11',
    ELECTRON_DISABLE_SANDBOX: '1',
    // Keeps the window off the developer's screen: a suite run otherwise pops
    // up and grabs focus once per spec file.
    ORRERY_HEADLESS: '1',
    ...extra
  }
}

/**
 * The switches every launch needs, whether it runs `out/` or a packaged build.
 *
 * `--ozone-platform=x11` is here rather than only in the environment because a
 * command line beats an environment variable, and a window that escapes onto
 * somebody's desktop is the kind of thing that should take two mistakes.
 */
export const LAUNCH_ARGS = ['--no-sandbox', '--ozone-platform=x11']

/**
 * Launch the app against a userData directory of its own.
 *
 * Without this every spec shares the developer's real userData, so settings,
 * the remembered session and the view mode carry from one spec into the next —
 * which is both a source of order-dependent failures and a way for a test run
 * to overwrite the settings of the machine it runs on.
 */
export async function launchApp(): Promise<ElectronApplication> {
  const userData = mkdtempSync(join(tmpdir(), 'orrery-userdata-'))
  userDataDirs.push(userData)
  return electron.launch({
    args: ['./out/main/index.js', ...LAUNCH_ARGS, `--user-data-dir=${userData}`],
    env: launchEnv()
  })
}

/**
 * Point the app at a test vault and wait until it has actually adopted it.
 *
 * The app restores the last opened folder on boot, so waiting for a file of
 * *this* vault to appear keeps that restore from racing the switch and leaving
 * the tree empty.
 */
export async function openVault(page: Page, vault: string, sentinelFile: string): Promise<void> {
  // Set explicitly rather than assumed: a spec may open a vault more than once,
  // and by then the app carries the session and view mode the spec left behind.
  await page.evaluate(async (v) => {
    const current = await window.orrery.invoke('settings:get', undefined)
    await window.orrery.invoke('settings:set', {
      lastOpenedFolder: v,
      session: { openPaths: [], activePath: '' },
      editor: { ...current.editor, viewMode: 'live' }
    })
  }, vault)
  await page.reload()
  await expect(page.locator('.tree-row--file', { hasText: sentinelFile })).toBeVisible({
    timeout: 15_000
  })
}

/**
 * Save every dirty tab, then close. A test that leaves unsaved work makes the
 * app raise its "save changes?" prompt on quit — correct behaviour, but nothing
 * in a headless run can answer it, so teardown would hang until it times out.
 *
 * The loop is bounded by the tabs actually left dirty rather than by a small
 * fixed number. A spec file that edits a dozen documents without saving them —
 * which is what a suite for a surface where saving is deliberate looks like —
 * ran past the old limit of twelve, and the tabs that were left then hung the
 * quit on the prompt this exists to avoid.
 *
 * And the prompt is answered anyway, as a backstop. Teardown must not be able
 * to hang: a save that fails for its own reasons is a thing for the test that
 * caused it to report, not something that should cost the whole run its
 * afterAll and leave an Electron process behind.
 */
export async function closeCleanly(app: ElectronApplication, page: Page): Promise<void> {
  const dirty = (): Promise<number> => page.locator('.tab__close--dirty').count()
  // One pass per dirty tab, plus a little slack for one that needs a second go.
  const attempts = (await dirty()) + 5
  for (let attempt = 0; attempt < attempts; attempt++) {
    if ((await dirty()) === 0) break
    await page
      .locator('.tab__close--dirty')
      .first()
      .locator('xpath=ancestor::*[contains(@class,"tab")][1]')
      .click()
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: 'file.save' })
    })
    await page.waitForTimeout(150)
  }
  // "Don't Save", for anything still unsaved. The vault is a temporary
  // directory that is about to be removed, so there is nothing here to lose.
  await app.evaluate(({ dialog }) => {
    dialog.showMessageBox = async () => ({ response: 1 }) as never
  })
  await app.close()
}
