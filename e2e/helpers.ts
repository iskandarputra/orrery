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
 * Launch the app against a userData directory of its own.
 *
 * Without this every spec shares the developer's real userData, so settings,
 * the remembered session and the view mode carry from one spec into the next —
 * which is both a source of order-dependent failures and a way for a test run
 * to overwrite the settings of the machine it runs on.
 */
export async function launchApp(): Promise<ElectronApplication> {
  const userData = mkdtempSync(join(tmpdir(), 'zymd-userdata-'))
  userDataDirs.push(userData)
  return electron.launch({
    args: ['./out/main/index.js', '--no-sandbox', `--user-data-dir=${userData}`],
    // ZYMD_HEADLESS keeps the window off the developer's screen: a suite run
    // otherwise pops up and grabs focus once per spec file.
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1', ZYMD_HEADLESS: '1' }
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
    const current = await window.zymd.invoke('settings:get', undefined)
    await window.zymd.invoke('settings:set', {
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
 */
export async function closeCleanly(app: ElectronApplication, page: Page): Promise<void> {
  for (let attempt = 0; attempt < 12; attempt++) {
    if ((await page.locator('.tab__close--dirty').count()) === 0) break
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
  await app.close()
}
