import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  test,
  expect,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

async function runCommand(commandId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

async function editAndSave(text: string): Promise<void> {
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type(text)
  await runCommand('file.save')
  await expect(page.locator('.tab__close--dirty')).toBeHidden({ timeout: 10_000 })
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'zymd-history-'))
  writeFileSync(join(vault, 'Note.md'), '# Note\n\noriginal body\n')
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Note.md')
  await page.locator('.tree-row--file', { hasText: 'Note.md' }).click()
  await page.waitForSelector('.cm-content')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('a save records a version', async () => {
  await editAndSave('\n\nfirst edit')

  await runCommand('note.history')
  await expect(page.locator('.history')).toBeVisible()
  await expect(page.locator('.history__item')).toHaveCount(1)
  await expect(page.locator('.history__preview pre')).toContainText('first edit')
  await page.keyboard.press('Escape')
})

test('rapid saves share one version', async () => {
  await editAndSave(' and more')
  await editAndSave(' and more again')

  await runCommand('note.history')
  // Both edits landed within the coalescing window.
  await expect(page.locator('.history__item')).toHaveCount(1)
  await page.keyboard.press('Escape')
})

test('restoring puts the old text back, undoably and unsaved', async () => {
  const onDisk = readFileSync(join(vault, 'Note.md'), 'utf-8')
  expect(onDisk).toContain('and more again')

  await runCommand('note.history')
  await page.locator('.history__item').first().click()
  await page.locator('.history__restore').click()

  // The editor holds the restored text; the file is untouched until saved.
  await expect(page.locator('.cm-content')).toContainText('first edit')
  await expect(page.locator('.cm-content')).not.toContainText('and more again')
  expect(readFileSync(join(vault, 'Note.md'), 'utf-8')).toBe(onDisk)

  // And it is one undo away, like any other edit.
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+z')
  await expect(page.locator('.cm-content')).toContainText('and more again')
})

test('a note with no history says so', async () => {
  writeFileSync(join(vault, 'Fresh.md'), '# Fresh\n')
  await page.locator('.tree-row--file', { hasText: 'Fresh.md' }).click()
  await expect(page.locator('.tab--active .tab__label')).toHaveText('Fresh.md')

  await runCommand('note.history')
  await expect(page.locator('.history')).toContainText('No versions yet')
  await page.keyboard.press('Escape')
})
