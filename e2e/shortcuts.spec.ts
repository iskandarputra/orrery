import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * The keys that format a note, and the hints that name them.
 *
 * Ctrl+B used to toggle the sidebar while the ribbon called it bold, and there
 * was no key for bold or italic at all. Playwright's key presses reach the page
 * and not the native menu, so what these exercise is the editor's own binding,
 * which is the one that has to win: the page sees a key before the menu does.
 */

let app: ElectronApplication
let page: Page
let vault: string

async function runCommand(commandId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

/** Open a file, put the caret at the end of its first line, and select the last word. */
async function selectLastWord(name: string): Promise<void> {
  await page.locator('.tree-row--file', { hasText: name }).click()
  await expect(page.locator('.tab--active')).toContainText(name)
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('End')
  await page.keyboard.press('Control+Shift+ArrowLeft')
}

async function saved(name: string): Promise<string> {
  await runCommand('file.save')
  await expect(page.locator('.tab__close--dirty')).toHaveCount(0)
  return readFileSync(join(vault, name), 'utf-8')
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-keys-'))
  writeFileSync(join(vault, 'Bold.md'), 'alpha beta\n')
  writeFileSync(join(vault, 'Italic.md'), 'gamma delta\n')
  writeFileSync(join(vault, 'code.ts'), 'const answer = 42\n')
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Bold.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('Ctrl+B makes the selection bold, and leaves the sidebar alone', async () => {
  const sidebar = await page.locator('.sidebar').isVisible()
  await selectLastWord('Bold.md')
  await page.keyboard.press('Control+B')
  expect(await saved('Bold.md')).toBe('alpha **beta**\n')
  expect(await page.locator('.sidebar').isVisible()).toBe(sidebar)
})

test('Ctrl+I makes the selection italic, and keeps it selected', async () => {
  await selectLastWord('Italic.md')
  await page.keyboard.press('Control+I')
  // Typing replaces the selection. Had Ctrl+I also run "select parent syntax",
  // the selection would have grown past the word and taken the markers with it.
  await page.keyboard.type('omega')
  expect(await saved('Italic.md')).toBe('gamma *omega*\n')
})

test('in source code neither key writes emphasis markers', async () => {
  await selectLastWord('code.ts')
  await page.keyboard.press('Control+B')
  await page.keyboard.press('Control+I')
  await expect(page.locator('.tab__close--dirty')).toHaveCount(0)
  expect(readFileSync(join(vault, 'code.ts'), 'utf-8')).toBe('const answer = 42\n')
})

test('the ribbon names the keys that do what it says', async () => {
  await page.locator('.tree-row--file', { hasText: 'Bold.md' }).click()
  const ribbon = page.locator('.header-btn[title="Toggle formatting ribbon"]')
  await ribbon.click()
  await expect(page.locator('.toolbar__btn[title^="Bold"]')).toHaveAttribute(
    'title',
    'Bold (Ctrl+B)'
  )
  await expect(page.locator('.toolbar__btn[title^="Italic"]')).toHaveAttribute(
    'title',
    'Italic (Ctrl+I)'
  )
  await ribbon.click()
})

test('the header button opens the command palette, and says so', async () => {
  const button = page.locator('.header-btn[title^="Command palette"]')
  await expect(button).toHaveAttribute('title', 'Command palette (Ctrl+Shift+P)')
  // From the file tree, with no editor focused: it used to do nothing then.
  await page.locator('.tree-row--file', { hasText: 'Italic.md' }).click()
  await button.click()
  await expect(page.locator('.palette')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.palette')).toBeHidden()
})

test('the palette shows a command its shipped key, not only a key somebody set', async () => {
  await runCommand('app.commandPalette')
  await page.locator('.palette__input').fill('Toggle Sidebar')
  const row = page.locator('.palette__item', { hasText: 'Toggle Sidebar' }).first()
  await expect(row.locator('.palette__badge')).toHaveText('Ctrl+Shift+E')
  await page.keyboard.press('Escape')
})
