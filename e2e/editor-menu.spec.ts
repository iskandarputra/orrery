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

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'zymd-menu-'))
  writeFileSync(join(vault, 'Note.md'), '# Note\n\nOwnership is the core idea here.\n')
  writeFileSync(join(vault, 'Other.md'), '# Other\n\nAlso mentions ownership once.\n')
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

test('right-clicking the editor opens a menu', async () => {
  await page.locator('.cm-content').click()
  await page.locator('.cm-content').click({ button: 'right' })
  await expect(page.locator('.ctx-menu')).toBeVisible()
  const text = await page.locator('.ctx-menu').textContent()
  expect(text).toContain('Copy')
  expect(text).toContain('Select all')
  await page.keyboard.press('Escape')
})

test('a selection unlocks formatting and vault search', async () => {
  // Select the word, then right-click *on it* — clicking elsewhere would
  // collapse the selection before the menu is built.
  const word = page.locator('.cm-content').getByText('Ownership', { exact: false }).first()
  await word.dblclick()
  await word.click({ button: 'right' })
  const menu = page.locator('.ctx-menu')
  await expect(menu).toBeVisible()
  const text = (await menu.textContent()) ?? ''
  expect(text).toContain('Bold')
  expect(text).toContain('Link')
  expect(text).toMatch(/Search vault/)
  await page.keyboard.press('Escape')
})

test('bold from the menu wraps the selection', async () => {
  const word = page.locator('.cm-content').getByText('Ownership', { exact: false }).first()
  await word.dblclick()
  await word.click({ button: 'right' })
  await page.locator('.ctx-menu').getByText('Bold').click()
  await expect(page.locator('.tab__close--dirty')).toBeVisible()
  await expect(page.locator('.cm-content')).toContainText('Ownership')
  await page.keyboard.press('Control+z')
})

test('searching the vault from the menu fills and runs the search', async () => {
  const word = page.locator('.cm-content').getByText('Ownership', { exact: false }).first()
  await word.dblclick()
  await word.click({ button: 'right' })
  await page.locator('.ctx-menu').getByText(/Search vault/).click()
  await expect(page.locator('.rpanel')).toBeVisible()
  // It ran on its own: results are already there.
  await expect(page.locator('.result-group__file').first()).toBeVisible({ timeout: 10_000 })
})
