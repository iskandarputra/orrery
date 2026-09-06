import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { closeCleanly, launchApp, openVault } from './helpers'
import { makePdf } from '../src/main/services/__fixtures__/make-pdf'

/**
 * The annotation tools, checked against what they actually leave on the page.
 *
 * `PdfViewer` writes pdf.js's editor mode numbers out by hand, because its own
 * constants live behind a dynamic import and a toolbar cannot wait for one. A
 * comment there claimed this file checked those numbers. It did not exist, and
 * the gap it left was a real one: the toolbar carried a Signature button whose
 * mode switched on, whose button lit up, and which could not make a signature,
 * because pdf.js routes that mode through a signature manager its own viewer
 * supplies and this app does not.
 *
 * So the test is not "does the mode change". A mode changing is exactly what
 * the broken tool did. It is "is there something on the page afterwards".
 */

let app: ElectronApplication
let page: Page
let vault: string

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-pdf-tools-'))
  writeFileSync(join(vault, 'Doc.pdf'), makePdf({ pages: [['Please sign below.', '', '', '']] }))
  writeFileSync(join(vault, 'Note.md'), '# Note\n')
  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1300, height: 900 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Note.md')
  await page.locator('.tree-row--file', { hasText: 'Doc.pdf' }).click()
  await expect(page.locator('.pdfv__count')).toHaveText('of 1', { timeout: 25_000 })
  await page.waitForTimeout(1500)
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

/** Editors currently on the page, which is what a tool is judged by. */
const editors = (): Promise<number> =>
  page.evaluate(() => document.querySelectorAll('.annotationEditorLayer > *').length)

test('every tool in the bar turns its own editor on', async () => {
  for (const [label, mode] of [
    ['Highlight', 'highlightEditing'],
    ['Text box', 'freetextEditing'],
    ['Draw', 'inkEditing']
  ] as const) {
    const button = page.locator(`button[aria-label="${label}"]`)
    await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'true')
    // The layer names the mode it is in, which is how a wrong number would show.
    await expect(page.locator('.annotationEditorLayer').first()).toHaveClass(new RegExp(mode), {
      timeout: 10_000
    })
    await button.click()
    await expect(button).toHaveAttribute('aria-pressed', 'false')
  }
})

test('drawing leaves something on the page', async () => {
  // The check the missing file would have made. A tool that switches its mode
  // on and produces nothing is the failure this is here to catch.
  const draw = page.locator('button[aria-label="Draw"]')
  await draw.click()
  const layer = await page.locator('.annotationEditorLayer').first().boundingBox()
  expect(layer).not.toBeNull()

  const before = await editors()
  const x = layer!.x + layer!.width * 0.25
  const y = layer!.y + layer!.height * 0.6
  await page.mouse.move(x, y)
  await page.mouse.down()
  for (let i = 1; i <= 14; i++) await page.mouse.move(x + i * 12, y + Math.sin(i / 2) * 20)
  await page.mouse.up()
  await draw.click()

  await expect.poll(editors, { timeout: 15_000 }).toBeGreaterThan(before)
  await expect(page.locator('.annotationEditorLayer .inkEditor').first()).toBeVisible()
  // And the document knows it has been changed, which is what makes it savable.
  await expect(page.locator('.tab__close--dirty')).toHaveCount(1)
})

test('offers no tool it cannot carry out', async () => {
  // Signature was in this bar. Its mode exists in pdf.js and switches on
  // happily; the editor behind it asks a signature manager for the signature,
  // this app supplies none, and the call is optional-chained, so pressing it
  // did nothing and said nothing. If it comes back, it comes back with the
  // dialog that makes it work.
  await expect(page.locator('button[aria-label="Signature"]')).toHaveCount(0)
  await expect(page.locator('.pdfv__tools button[aria-pressed]')).toHaveCount(3)
})
