import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * A table wider than the pane.
 *
 * The same failure the code fences had: a block that overflows its container
 * drags the whole document sideways, prose and headings with it, and every line
 * in the note becomes unreadable because one table is wide. `overflow-x: auto`
 * looks like it settles this and does not on its own — a block still offers its
 * min-content width to whatever is sizing it.
 */

const WIDE = (() => {
  const cols = Array.from({ length: 14 }, (_, i) => `Column heading number ${i + 1}`)
  const row = Array.from({ length: 14 }, (_, i) => `a fairly long cell value ${i + 1}`)
  return [
    '# Wide table',
    '',
    'Prose before the table, which must stay where it is.',
    '',
    `| ${cols.join(' | ')} |`,
    `| ${cols.map(() => '---').join(' | ')} |`,
    `| ${row.join(' | ')} |`,
    `| ${row.join(' | ')} |`,
    '',
    'Prose after.'
  ].join('\n')
})()

let app: ElectronApplication
let page: Page
let vault: string

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-table-'))
  writeFileSync(join(vault, 'Wide.md'), WIDE)
  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1100, height: 800 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Wide.md')
  await page.locator('.tree-row--file', { hasText: 'Wide.md' }).click()
  await expect(page.locator('.cm-or-table table')).toBeVisible({ timeout: 15_000 })
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('a wide table scrolls in its own box, not the document', async () => {
  const m = await page.evaluate(() => {
    const box = document.querySelector('.cm-or-table') as HTMLElement
    const table = box.querySelector('table') as HTMLElement
    const scroller = document.querySelector('.cm-scroller') as HTMLElement
    return {
      // The table really is wider than its container, or this proves nothing.
      tableWider: table.getBoundingClientRect().width > box.clientWidth + 1,
      boxCanScroll: box.scrollWidth > box.clientWidth + 1,
      documentExcessWidth: scroller.scrollWidth - scroller.clientWidth,
      boxWithinPane: box.clientWidth <= scroller.clientWidth + 1
    }
  })
  expect(m.tableWider, 'the table overflows its container').toBe(true)
  expect(m.boxCanScroll, 'the table scrolls inside its own box').toBe(true)
  expect(m.boxWithinPane, 'the box never grows past the pane').toBe(true)
  expect(m.documentExcessWidth, 'the document never scrolls sideways').toBe(0)
})

test('the prose around it keeps the reading column', async () => {
  // The point of the containment: a paragraph next to a wide table is still a
  // paragraph, at the same measure it would have had without one.
  const widths = await page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll('.cm-content .cm-line')) as HTMLElement[]
    const prose = lines.filter((l) => l.textContent?.startsWith('Prose'))
    return prose.map((l) => Math.round(l.getBoundingClientRect().width))
  })
  expect(widths.length).toBeGreaterThan(0)
  const scroller = await page
    .locator('.cm-scroller')
    .evaluate((el) => (el as HTMLElement).clientWidth)
  for (const w of widths) expect(w).toBeLessThanOrEqual(scroller + 1)
})

test('scrolling the table leaves the document where it was', async () => {
  const before = await page.locator('.cm-scroller').evaluate((el) => el.scrollLeft)
  await page.locator('.cm-or-table').evaluate((el) => {
    el.scrollLeft = el.scrollWidth
  })
  const after = await page.evaluate(() => ({
    box: (document.querySelector('.cm-or-table') as HTMLElement).scrollLeft,
    doc: (document.querySelector('.cm-scroller') as HTMLElement).scrollLeft
  }))
  expect(after.box, 'the table moved').toBeGreaterThan(0)
  expect(after.doc, 'the document did not').toBe(before)
})
