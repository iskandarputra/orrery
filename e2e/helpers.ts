import type { ElectronApplication, Page } from '@playwright/test'
import { expect } from '@playwright/test'

/**
 * Point the app at a test vault and wait until it has actually adopted it.
 *
 * The app restores the last opened folder on boot, which in a fresh run is the
 * previous run's deleted temp vault (settings live in real userData). Waiting
 * for a file of *this* vault to appear keeps that restore from racing the
 * switch and leaving the tree empty.
 */
export async function openVault(page: Page, vault: string, sentinelFile: string): Promise<void> {
  await page.evaluate((v) => window.zymd.invoke('settings:set', { lastOpenedFolder: v }), vault)
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
