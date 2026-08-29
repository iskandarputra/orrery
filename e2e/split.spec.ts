import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

async function runCommand(commandId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-split-'))
  writeFileSync(join(vault, 'Left.md'), '# Left\n\nleft body\n')
  writeFileSync(join(vault, 'Right.md'), '# Right\n\nright body\n')
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Left.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('splitting shows two notes side by side', async () => {
  await page.locator('.tree-row--file', { hasText: 'Right.md' }).click()
  await page.locator('.tree-row--file', { hasText: 'Left.md' }).click()
  await expect(page.locator('.editor-pane-host')).toHaveCount(1)

  await runCommand('view.toggleSplit')
  await expect(page.locator('.editor-pane-host')).toHaveCount(2)

  // Two different notes, one per pane — never the same buffer twice.
  const panes = page.locator('.editor-pane-host')
  await expect(panes.nth(0)).toContainText('Left')
  await expect(panes.nth(1)).toContainText('Right')
})

test('each pane edits its own note, and both save', async () => {
  await expect(page.locator('.editor-pane-host')).toHaveCount(2)
  await page.locator('.editor-pane-host').nth(0).locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\nedited left')

  // Clicking the second pane moves focus to it.
  await page.locator('.editor-pane-host').nth(1).locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\nedited right')

  await runCommand('file.save')
  await page.waitForTimeout(400)
  // The focused pane saved; switch focus and save the other.
  await runCommand('view.focusNextPane')
  await runCommand('file.save')
  await expect(page.locator('.tab__close--dirty')).toHaveCount(0, { timeout: 10_000 })

  expect(readFileSync(join(vault, 'Left.md'), 'utf-8')).toContain('edited left')
  expect(readFileSync(join(vault, 'Right.md'), 'utf-8')).toContain('edited right')
})

test('opening a note already shown in the other pane just moves focus there', async () => {
  const panes = page.locator('.editor-pane-host')
  await expect(panes).toHaveCount(2)
  const rightText = (await panes.nth(1).textContent()) ?? ''
  const name = rightText.includes('Left') ? 'Left.md' : 'Right.md'

  await page.locator('.tree-row--file', { hasText: name }).click()

  // Still split, notes unmoved — the same file never opens in two editors.
  await expect(panes).toHaveCount(2)
  await expect(panes.nth(1)).toContainText(name.replace('.md', ''))
  await expect(panes.nth(1)).toHaveClass(/editor-pane-host--focused/)
})

test('the split toggle flips both ways and keeps the note you were reading', async () => {
  const panes = page.locator('.editor-pane-host')
  // Start from a known state rather than inheriting one.
  if ((await panes.count()) === 2) await runCommand('view.toggleSplit')
  await expect(panes).toHaveCount(1)

  await runCommand('view.toggleSplit')
  await expect(panes).toHaveCount(2)
  // Splitting puts you in the new pane, which is the one you asked for.
  await expect(panes.nth(1)).toHaveClass(/editor-pane-host--focused/)
  const reading = await panes.nth(1).textContent()

  await runCommand('view.toggleSplit')
  await expect(panes).toHaveCount(1)
  // Collapsing keeps what you were looking at, rather than jumping elsewhere.
  expect(await panes.first().textContent()).toBe(reading)
})
