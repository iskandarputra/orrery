import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * A SQLite file, opened in the app.
 *
 * Built here with the same driver the app reads it with, so the test is against
 * a real database rather than a fixture that agrees with the viewer.
 */

let app: ElectronApplication
let page: Page
let vault: string
let dbPath: string

function makeDatabase(path: string): void {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite') as {
    DatabaseSync: new (p: string) => { exec(sql: string): void; close(): void }
  }
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT NOT NULL, size REAL);
    INSERT INTO notes (title, size) VALUES ('alpha', 3.5);
    INSERT INTO notes (title, size) VALUES ('beta', 1.5);
    INSERT INTO notes (title, size) VALUES ('gamma', 2.5);
    CREATE TABLE tags (name TEXT, note INTEGER);
    INSERT INTO tags VALUES ('draft', 1);
    CREATE VIEW big AS SELECT * FROM notes WHERE size > 2;
  `)
  db.close()
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-db-'))
  dbPath = join(vault, 'vault.db')
  makeDatabase(dbPath)
  writeFileSync(join(vault, 'Note.md'), '# Note\n')

  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Note.md')
  await page.locator('.tree-row--file', { hasText: 'vault.db' }).click()
  await expect(page.locator('.db')).toBeVisible({ timeout: 20_000 })
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('a database opens as its tables rather than as its bytes', async () => {
  // Read as text this file is a page header and a B-tree.
  await expect(page.locator('.editor-pane .cm-content')).toBeHidden()
  // Tables first, then views, each in alphabetical order.
  await expect(page.locator('.db__table-name')).toHaveText(['notes', 'tags', 'big'])
  // Each says how big it is, which is the first thing anyone asks.
  await expect(page.locator('.db__table', { hasText: 'notes' })).toContainText('3')
})

test('the first table is shown, with its columns and rows', async () => {
  await page.locator('.db__table', { hasText: 'notes' }).click()
  await expect(page.locator('.db__head-name')).toHaveText(['id', 'title', 'size'])
  await expect(page.locator('tbody tr')).toHaveCount(3)
  await expect(page.locator('.db__shape')).toContainText('3 columns')
})

test('a column sorts, both ways', async () => {
  const titles = (): Promise<string[]> => page.locator('tbody tr td:nth-child(3)').allTextContents()
  expect(await titles()).toEqual(['alpha', 'beta', 'gamma'])

  await page.locator('.db__sort', { hasText: 'size' }).click()
  await expect.poll(titles).toEqual(['beta', 'gamma', 'alpha'])

  await page.locator('.db__sort', { hasText: 'size' }).click()
  await expect.poll(titles).toEqual(['alpha', 'gamma', 'beta'])
})

test('a view reads like a table', async () => {
  await page.locator('.db__table', { hasText: 'big' }).click()
  await expect.poll(() => page.locator('tbody tr').count()).toBe(2)
})

test('a question can be asked in SQL', async () => {
  await page.locator('.db__action', { hasText: 'SQL' }).click()
  await page.locator('.db__sql-input').fill('select title from notes where size > 2 order by title')
  await page.locator('.db__sql-actions .btn').click()

  await expect(page.locator('.db__head-name')).toHaveText(['title'])
  await expect
    .poll(() => page.locator('tbody tr td:nth-child(2)').allTextContents())
    .toEqual(['alpha', 'gamma'])
})

test('anything that would change the file is refused, and the file is untouched', async () => {
  const before = statSync(dbPath).mtimeMs

  for (const sql of ['delete from notes', 'drop table notes', 'select 1; delete from notes']) {
    await page.locator('.db__sql-input').fill(sql)
    await page.locator('.db__sql-actions .btn').click()
    await expect(page.locator('.db__error')).toBeVisible()
  }

  // Still three rows, and the file has not been written to.
  await page.locator('.db__action', { hasText: 'SQL' }).click()
  await page.locator('.db__table', { hasText: 'notes' }).click()
  await expect.poll(() => page.locator('tbody tr').count()).toBe(3)
  expect(statSync(dbPath).mtimeMs).toBe(before)
})

test('a syntax error is reported rather than swallowed', async () => {
  await page.locator('.db__action', { hasText: 'SQL' }).click()
  await page.locator('.db__sql-input').fill('select from where')
  await page.locator('.db__sql-actions .btn').click()
  await expect(page.locator('.db__error')).toBeVisible()
})

test('the tab is a database, and never dirty', async () => {
  // Nothing is written into the document, so there is nothing to save.
  await expect(page.locator('.tab--active')).toContainText('vault.db')
  await expect(page.locator('.tab--active .tab__dirty-dot')).toHaveCount(0)
})

test('the rows fill the height they are given', async () => {
  // The same shape as the PDF reader had it wrong: a bar, an optional SQL box
  // and the results. Three grid rows with two children put the results in the
  // `auto` one, so they sized to their content and left the window empty.
  // An earlier test left a failed query on screen; close the box and pick a
  // table, so this measures a view with rows in it.
  if (await page.locator('.db__sql-input').isVisible()) {
    await page.locator('.db__action', { hasText: 'SQL' }).click()
  }
  await page.locator('.db__table', { hasText: 'notes' }).click()
  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 10_000 })

  const measured = await page.evaluate(() => {
    const main = document.querySelector('.db__main')!.getBoundingClientRect()
    const bar = document.querySelector('.db__bar')!.getBoundingClientRect()
    const scroll = document.querySelector('.db__scroll')!.getBoundingClientRect()
    return { available: main.height - bar.height, used: scroll.height }
  })
  expect(measured.used).toBeGreaterThan(measured.available - 2)
})

test('a table shows its rows again after a query that failed', async () => {
  // Picking the table you are already on has to mean "show me that table",
  // not "nothing has changed": after a failed query it was the only way back
  // and it did nothing.
  await page.locator('.db__table', { hasText: 'notes' }).click()
  await expect(page.locator('tbody tr')).toHaveCount(3, { timeout: 10_000 })

  await page.locator('.db__action', { hasText: 'SQL' }).click()
  await page.locator('.db__sql-input').fill('select from where')
  await page.locator('.db__sql-actions .btn').click()
  await expect(page.locator('.db__error')).toBeVisible()

  await page.locator('.db__table', { hasText: 'notes' }).click()
  await expect(page.locator('.db__error')).toHaveCount(0, { timeout: 10_000 })
  await expect(page.locator('tbody tr')).toHaveCount(3)
})
