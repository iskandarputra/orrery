import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * Markdown tables: the source lined up, and the rendering resized.
 *
 * Two different things, deliberately. Alignment is an edit to the file, because
 * the pipes are the file. A column width is not: markdown has nowhere to put
 * one, so it stays a way of looking at the table.
 */

let app: ElectronApplication
let page: Page
let vault: string

const RAGGED = [
  '# Table',
  '',
  '|name|qty|note|',
  '|-|-:|-|',
  '|pears|10|ripe|',
  '|a much longer name|1|x|',
  '',
  'Text after the table.',
  ''
].join('\n')

const read = (name = 'Table.md'): string => readFileSync(join(vault, name), 'utf-8')

async function runCommand(commandId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

/** Open a file from the tree and wait for its table to render. */
async function openTable(name: string): Promise<void> {
  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: name }).click()
  await expect(page.locator('.cm-or-table table')).toBeVisible({ timeout: 15_000 })
}

/** Put the cursor inside the table by clicking its rendering. */
async function enterTable(): Promise<void> {
  await page.locator('.cm-or-table table').click()
  await expect(page.locator('.cm-or-table-src').first()).toBeVisible({ timeout: 10_000 })
}

/** Click the heading above the table, which is outside it. */
async function leaveTable(): Promise<void> {
  await page.locator('.cm-content').click({ position: { x: 200, y: 12 } })
  await expect(page.locator('.cm-or-table table')).toBeVisible({ timeout: 10_000 })
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-mdtable-'))
  writeFileSync(join(vault, 'Table.md'), RAGGED)
  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1300, height: 860 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Table.md')
  await page.locator('.tree-row--file', { hasText: 'Table.md' }).click()
  await expect(page.locator('.cm-or-table table')).toBeVisible({ timeout: 15_000 })
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('a ragged table renders as a table, aligned as it asked to be', async () => {
  await expect(page.locator('.cm-or-table th')).toHaveText(['name', 'qty', 'note'])
  await expect(page.locator('.cm-or-table tbody tr')).toHaveCount(2)
  expect(
    await page
      .locator('.cm-or-table th')
      .nth(1)
      .evaluate((el) => getComputedStyle(el).textAlign)
  ).toBe('right')
})

test('a table you only looked at is left exactly as it was', async () => {
  // Walking the cursor through a table is not a reason to rewrite it, and
  // without this rule undoing a tidy would tidy it straight back.
  writeFileSync(join(vault, 'Untouched.md'), '# Untouched\n\n|a|b|\n|-|-|\n|1|2|\n')
  const before = read('Untouched.md')
  await openTable('Untouched.md')

  await enterTable()
  await leaveTable()

  await expect(page.locator('.tab--active .tab__dirty-dot')).toHaveCount(0)
  expect(read('Untouched.md')).toBe(before)
})

test('editing a table and leaving lines its pipes up, keeping the edit', async () => {
  await page.locator('.tree-row--file', { hasText: 'Table.md' }).click()
  await expect(page.locator('.cm-or-table table')).toBeVisible({ timeout: 15_000 })
  await enterTable()

  // Into the last cell of the last row. Typing past the closing pipe would
  // stop the block being a table at all, which is markdown's rule, not a bug.
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.type('EDITED')
  await expect(page.locator('.cm-content')).toContainText('EDITED')

  await leaveTable()
  await runCommand('file.save')

  await expect.poll(() => read()).toContain('xEDITED')
  const lines = read().split('\n')
  expect(lines[2]).toBe('| name               | qty | note    |')
  // The alignment each column declared survives: reformatting must not quietly
  // re-align somebody's columns.
  expect(lines[3]).toBe('| ------------------ | --: | ------- |')
  expect(lines[4]).toBe('| pears              |  10 | ripe    |')
})

test('the command lines a table up on demand, edited or not', async () => {
  // A line above the table, so opening the file does not put the cursor inside
  // it — which would show the source rather than the rendering.
  writeFileSync(join(vault, 'Second.md'), '# Second\n\n|a|b|\n|-|-|\n|1|22222|\n')
  await openTable('Second.md')

  await page.locator('.cm-or-table table').click()
  await runCommand('format.table')
  await runCommand('file.save')

  await expect.poll(() => read('Second.md')).toContain('| a   | b     |')
})

test('a column can be dragged wider, and that is not an edit', async () => {
  await openTable('Table.md')

  const widthOf = (n: number): Promise<number> =>
    page
      .locator('.cm-or-table th')
      .nth(n)
      .evaluate((el) => el.getBoundingClientRect().width)
  const before = [await widthOf(0), await widthOf(1)]

  const grip = (await page.locator('.cm-or-table-grip').first().boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + 200, grip.y + grip.height / 2, { steps: 8 })
  await page.mouse.up()

  const after = [await widthOf(0), await widthOf(1)]
  expect(after[0]!).toBeGreaterThan(before[0]! + 15)
  // The neighbour gives up exactly what this column takes, so the table keeps
  // its width rather than growing past its box.
  expect(after[0]! + after[1]!).toBeCloseTo(before[0]! + before[1]!, 0)
  // And it stops rather than squeezing the neighbour to nothing.
  expect(after[1]!).toBeGreaterThan(40)
  // Markdown has nowhere to put a width, so the file is untouched and the
  // table did not open for editing under the drag.
  await expect(page.locator('.tab--active .tab__dirty-dot')).toHaveCount(0)
  await expect(page.locator('.cm-or-table table')).toBeVisible()
})

test('double-clicking the grip gives the widths back to the content', async () => {
  const widthOf = (n: number): Promise<number> =>
    page
      .locator('.cm-or-table th')
      .nth(n)
      .evaluate((el) => el.getBoundingClientRect().width)
  const dragged = await widthOf(0)

  await page.locator('.cm-or-table-grip').first().dblclick()
  await expect.poll(() => widthOf(0)).toBeLessThan(dragged - 40)
})
