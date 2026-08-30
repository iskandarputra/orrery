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

/** Numbers that sort differently as text and as numbers: 9 < 10 < 100. */
const SORTABLE = 'name,qty\npears,10\napples,9\nfigs,100\n'

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
  writeFileSync(join(vault, 'sortable.csv'), SORTABLE)
  // Tall enough to scroll, so the frozen header and corner can be measured.
  writeFileSync(
    join(vault, 'tall.csv'),
    'name,qty\n' + Array.from({ length: 60 }, (_, i) => `row${i},${i}`).join('\n') + '\n'
  )
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

test('a column sorts the view without touching the file', async () => {
  await open('sortable.csv')
  const column = async (): Promise<string[]> =>
    page
      .locator('.csv__input:not(.csv__input--head)')
      .evaluateAll((els) =>
        (els as HTMLInputElement[]).filter((_, i) => i % 2 === 0).map((el) => el.value)
      )

  expect(await column()).toEqual(['pears', 'apples', 'figs'])

  await page.getByLabel('Sort by qty').click()
  // 9 before 10 before 100: numbers sorted as numbers, which is the whole
  // reason a table view is not a text view.
  expect(await column()).toEqual(['apples', 'pears', 'figs'])

  await page.getByLabel('Sort by qty').click()
  expect(await column()).toEqual(['figs', 'pears', 'apples'])

  // And the file is exactly as it was: looking at a column is not an edit.
  await expect(page.locator('.tab--active .tab__dirty-dot')).toHaveCount(0)
  expect(read('sortable.csv')).toBe(SORTABLE)
})

test('an edit in a sorted view lands in the row it was typed into', async () => {
  // The trap this design exists to avoid: writing the value into whichever row
  // happened to be in that position before the sort.
  await open('sortable.csv')
  // The header cycles ascending, descending, off, and the previous test left
  // it somewhere: click until it is ascending rather than assuming.
  const first = page.locator('.csv__input:not(.csv__input--head)').first()
  for (let i = 0; i < 3 && (await first.inputValue()) !== 'apples'; i++) {
    await page.getByLabel('Sort by qty').click()
  }
  await expect(first).toHaveValue('apples')
  await first.fill('APPLES')
  await save()

  const written = read('sortable.csv')
  expect(written).toContain('APPLES,9')
  expect(written).toContain('pears,10')
  // Row order in the file is untouched by the sort.
  expect(written.trim().split('\n')[1]).toBe('pears,10')
})

test('the filter hides rows and says how many', async () => {
  await open('sortable.csv')
  await page.locator('.csv__filter-input').fill('pea')
  await expect(page.locator('.csv__shape')).toContainText('2 hidden')
  await expect(page.locator('tbody tr')).toHaveCount(1)

  await page.locator('.csv__filter-clear').click()
  await expect(page.locator('tbody tr')).toHaveCount(3)
})

test('a column can be dragged to a new place, and that is an edit', async () => {
  await open('sortable.csv')
  const headers = async (): Promise<string[]> =>
    page
      .locator('.csv__input--head')
      .evaluateAll((els) => (els as HTMLInputElement[]).map((el) => el.value))
  expect(await headers()).toEqual(['name', 'qty'])

  await page.locator('.csv__head').first().dragTo(page.locator('.csv__head').nth(1))

  expect(await headers()).toEqual(['qty', 'name'])
  await save()
  expect(read('sortable.csv').trim().split('\n')[0]).toBe('qty,name')
})

test('a column can be resized by its edge', async () => {
  await open('sortable.csv')
  const widthOf = (): Promise<number> =>
    page
      .locator('.csv__head')
      .first()
      .evaluate((el) => el.getBoundingClientRect().width)
  const before = await widthOf()

  const grip = (await page.locator('.csv__grip').first().boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + 120, grip.y + grip.height / 2, { steps: 8 })
  await page.mouse.up()

  expect(await widthOf()).toBeGreaterThan(before + 90)
  // A width is a way of looking at the file, so the file is unchanged.
  await expect(page.locator('.tab--active .tab__dirty-dot')).toHaveCount(0)
})

test('the numbers column stays put, and stays under the header', async () => {
  // The corner cell is both a header and a gutter. It stuck to the left and
  // not to the top, so scrolling slid the row numbers over the frozen header.
  await open('tall.csv')
  await page.locator('.csv__scroll').evaluate((el) => {
    el.scrollTop = 300
  })
  await page.waitForTimeout(120)

  const rows = await page.evaluate(() => {
    const corner = document.querySelector('thead .csv__gutter')!.getBoundingClientRect()
    const head = document.querySelector('.csv__head')!.getBoundingClientRect()
    const scroll = document.querySelector('.csv__scroll')!.getBoundingClientRect()
    return { cornerTop: corner.top, headTop: head.top, scrollTop: scroll.top }
  })

  // The corner is level with the header it belongs to, and both are at the top
  // of the scroller rather than somewhere up the page.
  expect(Math.abs(rows.cornerTop - rows.headTop)).toBeLessThan(1.5)
  expect(rows.cornerTop).toBeGreaterThanOrEqual(rows.scrollTop - 1)
})

test('the outline says what a table is, rather than asking for headings', async () => {
  // Telling someone to add "# Headings" to a spreadsheet is advice that would
  // corrupt it.
  await open('people.csv')
  await expect(page.locator('.rpanel-empty')).toContainText('this is a CSV')
  await expect(page.locator('.rpanel-empty')).not.toContainText('# Headings')
})
