import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { closeCleanly, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'zymd-slash-'))
  writeFileSync(join(vault, 'Note.md'), '# Note\n\n')
  app = await electron.launch({
    args: ['./out/main/index.js', '--no-sandbox'],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
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

/**
 * Accept by clicking the option rather than pressing Enter. Between asserting
 * that the menu is open and sending a key, the tooltip can close — and the
 * Enter then just inserts a newline, which looks like a broken menu.
 */
async function acceptCompletion(label: string): Promise<void> {
  const option = page.locator('.cm-tooltip-autocomplete li', { hasText: label }).first()
  await expect(option).toBeVisible({ timeout: 10_000 })
  await option.click()
}

/**
 * Start each test from an empty note and type on a line of its own.
 *
 * These tests share one editor, and chaining them on whatever the previous one
 * left behind made them flaky: a command typed at the end of an existing line
 * rightly doesn't trigger, so the failure looked like a broken menu.
 */
async function typeOnFreshLine(text: string): Promise<void> {
  await expect(page.locator('.cm-tooltip-autocomplete')).toBeHidden()
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  // Typed with a delay: Playwright's default fires keys faster than a person
  // ever could, and the completion debounce then sees one burst rather than a
  // sequence — which is what made these tests flaky.
  await page.keyboard.type(text, { delay: 25 })
}

test('slash opens the insert menu', async () => {
  await typeOnFreshLine('/')
  const menu = page.locator('.cm-tooltip-autocomplete')
  await expect(menu).toBeVisible({ timeout: 10_000 })
  const text = (await menu.textContent()) ?? ''
  expect(text).toContain('Table')
  expect(text).toContain('Code block')
  await page.keyboard.press('Escape')
})

test('typing filters, including by keyword', async () => {
  await typeOnFreshLine('/todo')
  const menu = page.locator('.cm-tooltip-autocomplete')
  await expect(menu).toBeVisible({ timeout: 10_000 })
  // "todo" is not in the label — it finds the task list by keyword.
  await expect(menu).toContainText('Task list')
  await page.keyboard.press('Escape')
})

test('choosing an item inserts the block and removes the command', async () => {
  await typeOnFreshLine('/quote')
  await acceptCompletion('Quote')

  // The block is there and the typed "/quote" is gone.
  await expect(page.locator('.cm-zy-blockquote').last()).toBeVisible({ timeout: 10_000 })
  await expect(page.locator('.cm-content')).not.toContainText('/quote')
})

test('a slash in ordinary prose is left alone', async () => {
  await typeOnFreshLine('and/or https://example.com')
  await expect(page.locator('.cm-tooltip-autocomplete')).toBeHidden()
})

test('colon completes an emoji to its glyph', async () => {
  await typeOnFreshLine(':rocket')
  await acceptCompletion(':rocket:')
  await expect(page.locator('.cm-content')).toContainText('🚀')
  await expect(page.locator('.cm-content')).not.toContainText(':rocket')
})
