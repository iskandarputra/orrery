import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
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

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-tags-'))
  writeFileSync(join(vault, 'Alpha.md'), '# Alpha\n\nAbout #rust and #project work.\n')
  writeFileSync(join(vault, 'Beta.md'), '# Beta\n\nMore #rust, plus a fence:\n\n```\n#include <stdio.h>\n```\n')
  writeFileSync(join(vault, 'Gamma.md'), '# Gamma\n\nNothing tagged here.\n')

  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Alpha.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('tags render as pills, and code fences are left alone', async () => {
  await page.locator('.tree-row--file', { hasText: 'Alpha.md' }).click()
  await expect(page.locator('.cm-or-tag')).toHaveCount(2)
  await expect(page.locator('.cm-or-tag').first()).toHaveText('#rust')

  await page.locator('.tree-row--file', { hasText: 'Beta.md' }).click()
  // `#include` inside the fence is not a tag; only #rust is.
  await expect(page.locator('.cm-or-tag')).toHaveCount(1)
  await expect(page.locator('.cm-or-tag')).toHaveText('#rust')
})

test('the tag pane counts notes per tag and searches on click', async () => {
  await runCommand('view.toggleBacklinks')
  await page.waitForSelector('.rpanel')
  await page.locator('.rpanel__tab[aria-label="Tags"]').click()
  await page.waitForSelector('.tags-panel')

  // #rust is in two notes, #project in one — most used first.
  const first = page.locator('.tags-panel__tag').first()
  await expect(first.locator('.tags-panel__name')).toHaveText('#rust')
  await expect(first.locator('.tags-panel__count')).toHaveText('2')
  await expect(page.locator('.tags-panel__tag')).toHaveCount(2)

  await first.click()
  // Clicking runs a vault search for that tag.
  await expect(page.locator('.result-group__file').first()).toBeVisible({ timeout: 10_000 })
})

test('filtering the pane narrows the list', async () => {
  await page.locator('.rpanel__tab[aria-label="Tags"]').click()
  await page.locator('.tags-panel__filter').fill('proj')
  await expect(page.locator('.tags-panel__tag')).toHaveCount(1)
  await expect(page.locator('.tags-panel__name')).toHaveText('#project')
  await page.locator('.tags-panel__filter').fill('')
})

test('typing # offers tags the vault already uses', async () => {
  await page.locator('.tree-row--file', { hasText: 'Gamma.md' }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\n\n#ru')

  const options = page.locator('.cm-tooltip-autocomplete li')
  await expect(options.first()).toBeVisible({ timeout: 10_000 })
  await expect(options.filter({ hasText: 'rust' }).first()).toBeVisible()
  await page.keyboard.press('Escape')
})
