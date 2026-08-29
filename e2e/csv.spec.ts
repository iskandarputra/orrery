import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * CSV as a table.
 *
 * A CSV opened as text is a wall of commas; the columns are the whole point of
 * the format and the one thing a text editor cannot show.
 */

const CSV = '"Smith, John",42,"say ""hi"""\nBrown,7,plain\n'

let app: ElectronApplication
let page: Page
let vault: string

const file = (name = 'people.csv'): string => join(vault, name)
const read = (name = 'people.csv'): string => readFileSync(file(name), 'utf-8')

const open = async (name: string): Promise<void> => {
  await page.locator('.tree-row--file', { hasText: name }).click()
  await expect(page.locator('.csv__table')).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(500)
}

const save = async (): Promise<void> => {
  // The table writes back on a debounce, so the document has to catch up before
  // saving it; otherwise the save reads the text from before the edit.
  await page.waitForTimeout(700)
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: 'file.save' })
  })
  await page.waitForTimeout(900)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-csv-'))
  writeFileSync(file(), 'name,age,note\n' + CSV)
  writeFileSync(join(vault, 'euro.csv'), 'a;b\n1;2\n')
  writeFileSync(join(vault, 'Note.md'), '# Note\n')
  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1300, height: 860 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Note.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('a .csv opens as a table, not as its text', async () => {
  await open('people.csv')
  await expect(page.locator('.editor-pane .cm-content')).toBeHidden()
  await expect(page.locator('.csv__shape')).toContainText('3 rows')
  await expect(page.locator('.csv__shape')).toContainText('3 columns')
})

test('quoted fields are read as one cell, commas and quotes included', async () => {
  // Splitting on commas would make four cells of the first row and lose the
  // doubled quotes entirely.
  await open('people.csv')
  const values = await page
    .locator('.csv__input')
    .evaluateAll((els) => (els as HTMLInputElement[]).map((el) => el.value))
  expect(values).toContain('Smith, John')
  expect(values).toContain('say "hi"')
})

test('editing a cell writes the file back, re-quoting only what needs it', async () => {
  await open('people.csv')
  // Row 3 is Brown; row 2 is the one carrying the doubled quotes, which the
  // assertion below checks survived untouched.
  const cell = page.getByLabel('Row 3, column 3')
  await cell.fill('now, with a comma')
  await expect(page.locator('.tab--active .tab__dirty-dot')).toHaveCount(1)
  await save()

  const written = read()
  expect(written).toContain('"now, with a comma"')
  // The untouched rows keep their original quoting.
  expect(written).toContain('"say ""hi"""')
  expect(written).toContain('Brown,7,"now, with a comma"')
})

test('a row and a column can be added', async () => {
  await open('people.csv')
  await page.locator('.csv__action', { hasText: 'Row' }).click()
  await expect(page.locator('.csv__shape')).toContainText('4 rows')
  await page.locator('.csv__action', { hasText: 'Column' }).click()
  await expect(page.locator('.csv__shape')).toContainText('4 columns')
  await save()
  expect(read().trim().split('\n')).toHaveLength(4)
})

test('a row can be deleted', async () => {
  await open('people.csv')
  await page.getByLabel('Delete row 4').click()
  await expect(page.locator('.csv__shape')).toContainText('3 rows')
  await save()
  expect(read().trim().split('\n')).toHaveLength(3)
})

test('a semicolon file keeps its delimiter', async () => {
  // A European spreadsheet export read as commas would be a single column.
  await open('euro.csv')
  await expect(page.locator('.csv__shape')).toContainText('2 columns')
  await expect(page.locator('.csv__delimiter')).toContainText('; separated')

  await page.getByLabel('Row 2, column 2').fill('9')
  await save()
  expect(read('euro.csv')).toBe('a;b\n1;9\n')
})

test('reopening does not lose the table', async () => {
  // The hazard every document surface shares: the pane registers its view in an
  // effect, so reading too early would write an empty grid over the file.
  await open('people.csv')
  const before = read()
  await page.locator('.tree-row--file', { hasText: 'Note.md' }).click()
  await page.waitForTimeout(400)
  await open('people.csv')
  await save()
  expect(read()).toBe(before)
})

test('the outline says what a table is, rather than asking for headings', async () => {
  // Telling someone to add "# Headings" to a spreadsheet is advice that would
  // corrupt it.
  await open('people.csv')
  await expect(page.locator('.rpanel-empty')).toContainText('this is a CSV')
  await expect(page.locator('.rpanel-empty')).not.toContainText('# Headings')
})
