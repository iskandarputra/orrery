import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * Reopening what you had open.
 *
 * Two ways in, and they read the same list: the palette, which can be searched
 * and reached from the keyboard, and the File menu's submenu, which is where
 * anyone arriving from another editor looks first.
 */

let app: ElectronApplication
let page: Page
let vault: string

async function runCommand(commandId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

/** The File → Open Recent submenu, as labels. */
async function recentMenu(): Promise<string[]> {
  return app.evaluate(({ Menu }) => {
    const file = Menu.getApplicationMenu()?.items.find(
      (item) => item.label.replace('&', '') === 'File'
    )
    const recent = file?.submenu?.items.find((item) => item.label === 'Open Recent')
    return (recent?.submenu?.items ?? []).map((item) => item.label)
  })
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-recent-'))
  writeFileSync(join(vault, 'First.md'), '# First\n')
  writeFileSync(join(vault, 'Second.md'), '# Second\n')
  writeFileSync(join(vault, 'Third.md'), '# Third\n')
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'First.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('the palette lists what has been opened, most recent first', async () => {
  for (const name of ['First.md', 'Second.md', 'Third.md']) {
    await page.locator('.tree-row--file', { hasText: name }).click()
    await expect(page.locator('.tab--active')).toContainText(name.replace('.md', ''))
  }

  await runCommand('file.openRecent')
  await expect(page.locator('.palette')).toBeVisible()

  const labels = await page.locator('.palette__label').allTextContents()
  expect(labels.slice(0, 3)).toEqual(['Third', 'Second', 'First'])
  await page.keyboard.press('Escape')
})

test('it lists the folder as well as the files', async () => {
  await runCommand('file.openRecent')
  await expect(page.locator('.palette__detail', { hasText: 'folder' }).first()).toBeVisible()
  await page.keyboard.press('Escape')
})

test('picking one opens it', async () => {
  // Somewhere else first, so the choice is visible.
  await page.locator('.tree-row--file', { hasText: 'First.md' }).click()
  await expect(page.locator('.tab--active')).toContainText('First')

  await runCommand('file.openRecent')
  await page.locator('.palette__input').fill('Third')
  await page.keyboard.press('Enter')

  await expect(page.locator('.tab--active')).toContainText('Third')
})

test('Ctrl+Enter reopens it beside what is already there', async () => {
  await runCommand('view.closePane').catch(() => undefined)
  await runCommand('file.openRecent')
  await page.locator('.palette__input').fill('Second')
  await page.keyboard.press('Control+Enter')

  await expect(page.locator('.editor-pane-host')).toHaveCount(2)
})

test('the File menu carries the same list', async () => {
  const labels = await recentMenu()
  expect(labels[0]).toBe('Open Recent…')
  expect(labels).toContain('Files')
  expect(labels).toContain('Folders')
  // Shortened for a menu, and the newest is at the top of its group.
  expect(labels.some((label) => label.endsWith('/Third.md'))).toBe(true)
  expect(labels.indexOf('Files')).toBeLessThan(labels.indexOf('Folders'))
})

test('the menu grows as more is opened, without a restart', async () => {
  const before = await recentMenu()
  writeFileSync(join(vault, 'Fourth.md'), '# Fourth\n')
  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Fourth.md' }).click()
  await expect(page.locator('.tab--active')).toContainText('Fourth')

  // A native menu cannot read state; it is state, copied, so it is rebuilt.
  await expect
    .poll(async () => (await recentMenu()).some((label) => label.endsWith('/Fourth.md')))
    .toBe(true)
  expect((await recentMenu()).length).toBeGreaterThan(before.length - 1)
})
