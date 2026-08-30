import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'
import { makePdf } from './fixtures/make-pdf'

/**
 * A PDF, opened in the app.
 *
 * The fixture is written by `make-pdf.ts` rather than checked in, so what is
 * on each page is visible in the test that asserts it.
 */

let app: ElectronApplication
let page: Page
let vault: string
let pdfPath: string
let openedAt: number

const PAGES = [
  ['Orrery reads PDFs now.', 'A second line on the first page.'],
  ['Page two speaks of kestrels.'],
  ['Page three, the last one.']
]

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-pdf-'))
  pdfPath = join(vault, 'Paper.pdf')
  writeFileSync(
    pdfPath,
    makePdf({
      pages: PAGES,
      outline: [
        { title: 'Chapter one', page: 1 },
        { title: 'Chapter two', page: 2 }
      ]
    })
  )
  writeFileSync(join(vault, 'Note.md'), '# Note\n')
  openedAt = statSync(pdfPath).mtimeMs

  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1300, height: 900 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Note.md')
  await page.locator('.tree-row--file', { hasText: 'Paper.pdf' }).click()
  await expect(page.locator('.pdfv')).toBeVisible({ timeout: 30_000 })
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('a PDF opens as pages rather than as its bytes', async () => {
  // Read as text this file is a page tree and a pile of streams.
  await expect(page.locator('.editor-pane .cm-content')).toBeHidden()
  await expect(page.locator('.pdfv__count')).toHaveText('of 3')
  await expect(page.locator('.pdfViewer .page').first()).toBeVisible({ timeout: 20_000 })
})

test('the text is text: drawn into a layer you can select and copy from', async () => {
  // Not a picture of a page: the words are in the DOM, which is what makes a
  // PDF selectable, copyable and findable rather than a photograph of writing.
  const layer = page.locator('.pdfViewer .page').first().locator('.textLayer')
  await expect(layer).toContainText('Orrery reads PDFs now.', { timeout: 20_000 })
  await expect(layer).toContainText('A second line on the first page.')
})

test('the page itself is drawn, glyphs and all', async () => {
  // The test above passes on the text layer alone, which is invisible DOM over
  // a canvas — it would still pass if every page rendered blank. This counts
  // the dark pixels in the canvas underneath, which is the only way to tell
  // "drawn" from "laid out", and the only thing that catches a worker that
  // never started or a page that failed silently.
  const ink = (): Promise<number> =>
    page
      .locator('.pdfViewer .page canvas')
      .first()
      .evaluate((canvas: HTMLCanvasElement) => {
        const context = canvas.getContext('2d')
        if (!context || canvas.width === 0) return -1
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
        let dark = 0
        for (let i = 0; i < data.length; i += 4) {
          if (data[i]! < 128 && data[i + 1]! < 128 && data[i + 2]! < 128) dark++
        }
        return dark
      })

  await expect.poll(ink, { timeout: 20_000 }).toBeGreaterThan(200)
})

test('find counts the matches and marks them on the page', async () => {
  await page.locator('button[aria-label="Find in this document"]').click()
  await page.locator('.pdfv__find-input').fill('kestrels')
  await page.locator('.pdfv__find-input').press('Enter')

  await expect(page.locator('.pdfv__find-count')).toHaveText('1 of 1', { timeout: 20_000 })
  // The match is marked in the text layer, which is what makes it findable by
  // eye rather than only counted.
  await expect(page.locator('.textLayer .highlight').first()).toBeVisible()

  await page.locator('.pdfv__find-input').fill('nothing here says this')
  await page.locator('.pdfv__find-input').press('Enter')
  await expect(page.locator('.pdfv__find-count')).toHaveText('no matches', { timeout: 20_000 })
  await page.locator('button[aria-label="Close find"]').click()
})

test('the outline goes to the page it names', async () => {
  await page.locator('.pdfv__outline-row', { hasText: 'Chapter two' }).click()
  await expect(page.locator('.pdfv__page-input')).toHaveValue('2', { timeout: 10_000 })
})

test('a thumbnail draws its page, and clicking one goes there', async () => {
  await page.locator('.pdfv__tab', { hasText: 'Pages' }).click()
  const thumbs = page.locator('.pdfv__thumb')
  await expect(thumbs).toHaveCount(3)

  // Drawn, not merely laid out: a blank canvas would have no ink in it.
  await expect
    .poll(
      () =>
        thumbs
          .first()
          .locator('canvas')
          .evaluate((canvas: HTMLCanvasElement) => {
            const context = canvas.getContext('2d')
            if (!context || canvas.width === 0) return false
            const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
            for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true
            return false
          }),
      { timeout: 20_000 }
    )
    .toBe(true)

  await thumbs.nth(2).click()
  await expect(page.locator('.pdfv__page-input')).toHaveValue('3', { timeout: 10_000 })
})

test('zooming redraws the page at the new size', async () => {
  const width = (): Promise<number> =>
    page
      .locator('.pdfViewer .page')
      .first()
      .evaluate((el) => el.getBoundingClientRect().width)
  const before = await width()

  await page.locator('button[aria-label="Zoom in"]').click()
  await expect.poll(width).toBeGreaterThan(before + 5)

  await page.locator('button[aria-label="Zoom out"]').click()
  await expect.poll(width).toBeLessThan((await width()) + 5)
})

test('the pages can be turned from the toolbar', async () => {
  await page.locator('.pdfv__page-input').fill('1')
  await expect(page.locator('.pdfv__page-input')).toHaveValue('1')
  await page.locator('button[aria-label="Next page"]').click()
  await expect(page.locator('.pdfv__page-input')).toHaveValue('2', { timeout: 10_000 })
})

test('reading a PDF never writes to it', async () => {
  // The reader opens the file read-only and has nothing to save; a tab that
  // could go dirty would be a tab that could lose somebody's document.
  await expect(page.locator('.tab--active')).toContainText('Paper.pdf')
  await expect(page.locator('.tab--active .tab__dirty-dot')).toHaveCount(0)
  expect(statSync(pdfPath).mtimeMs).toBe(openedAt)
})
