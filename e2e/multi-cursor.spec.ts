import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

const SOURCE = ['aaa one', 'aaa two', 'aaa three', 'bbb four'].join('\n') + '\n'

async function open(file: string): Promise<void> {
  await page.locator('.tree-row--file', { hasText: file }).click()
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 15_000 })
}

async function text(): Promise<string> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.cm-content .cm-line'))
      .map((l) => l.textContent)
      .join('\n')
  )
}

/** How many separate cursors the editor is currently drawing. */
async function cursorCount(): Promise<number> {
  return page.evaluate(() => document.querySelectorAll('.cm-cursor').length)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-multicursor-'))
  writeFileSync(join(vault, 'Note.md'), '# Note\n')
  // One file per test: a multi-cursor test edits its fixture by design, so
  // sharing one would leave the next test reading the previous one's output.
  for (const name of ['occurrences.ts', 'column.ts', 'collapse.ts']) {
    writeFileSync(join(vault, name), SOURCE)
  }
  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1300, height: 850 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'occurrences.ts')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('Mod-D adds a cursor at the next occurrence, and typing edits all of them', async () => {
  await open('occurrences.ts')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+Home')
  // Select the first "aaa", then add the next two occurrences.
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight')
  // One at a time: each press searches the document, and firing the second
  // before the first has landed loses it.
  await page.keyboard.press('Control+d')
  await expect.poll(cursorCount, { timeout: 10_000 }).toBe(2)
  await page.keyboard.press('Control+d')
  await expect.poll(cursorCount, { timeout: 10_000 }).toBe(3)

  await page.keyboard.type('zz')
  const after = await text()
  expect(after.split('\n').slice(0, 3)).toEqual(['zz one', 'zz two', 'zz three'])
  // The line that never matched is untouched.
  expect(after.split('\n')[3]).toBe('bbb four')
})

test('Alt-drag makes a column selection down several lines', async () => {
  await open('column.ts')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+Home')

  const first = (await page.locator('.cm-content .cm-line').first().boundingBox())!
  const third = (await page.locator('.cm-content .cm-line').nth(2).boundingBox())!

  // Alt-drag straight down: one cursor per line, all in the same column.
  await page.keyboard.down('Alt')
  await page.mouse.move(first.x + 4, first.y + first.height / 2)
  await page.mouse.down()
  await page.mouse.move(third.x + 4, third.y + third.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.keyboard.up('Alt')

  expect(await cursorCount()).toBe(3)

  // One keystroke, three lines changed at the same column.
  await page.keyboard.type('#')
  const lines = (await text()).split('\n')
  expect(lines.slice(0, 3)).toEqual(['#aaa one', '#aaa two', '#aaa three'])
  expect(lines[3]).toBe('bbb four')
})

test('Escape collapses back to a single cursor', async () => {
  await open('collapse.ts')
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+Home')
  for (let i = 0; i < 3; i++) await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Control+d')
  await expect.poll(cursorCount, { timeout: 10_000 }).toBeGreaterThan(1)

  // One press, not two: defaultKeymap's Escape is bound, but something ahead
  // of it consumes the first press.
  await page.keyboard.press('Escape')
  await expect.poll(cursorCount, { timeout: 10_000 }).toBe(1)
})
