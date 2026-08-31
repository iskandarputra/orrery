import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'
import { makePdf } from '../src/main/services/__fixtures__/make-pdf'

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

test('vault search finds words that only exist inside a PDF', async () => {
  // The blind spot a knowledge base usually has: every search walks the folder
  // reading files as text, and to that walk a PDF is a binary to skip.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleSearch'
    })
  })
  await page.locator('.gsearch__input').fill('kestrels')
  await page.locator('.gsearch__input').press('Enter')

  const hit = page.locator('.result-group', { hasText: 'Paper.pdf' })
  await expect(hit).toBeVisible({ timeout: 20_000 })
  // A paper has pages where a note has lines, and the result says which.
  await expect(hit.locator('.result-snippet__line').first()).toHaveText('p2')

  await hit.locator('.result-snippet').first().click()
  await expect(page.locator('.pdfv__page-input')).toHaveValue('2', { timeout: 15_000 })
})

test('a link can point at a page, and lands on it', async () => {
  writeFileSync(
    join(vault, 'Reading.md'),
    '# Reading\n\nSee [[Paper.pdf#page=3]] for the last of it.\n'
  )
  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Reading.md' }).click()
  await expect(page.locator('.cm-content')).toContainText('See', { timeout: 15_000 })

  // A link to a file that exists is not drawn as a broken one.
  const link = page.locator('.cm-or-wikilink').first()
  await expect(link).toBeVisible()
  await expect(link).not.toHaveClass(/cm-or-wikilink--missing/)

  await link.click({ modifiers: ['Control'] })
  await expect(page.locator('.pdfv')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.pdfv__page-input')).toHaveValue('3', { timeout: 15_000 })
})

test('a selection becomes a quote in a note beside the paper', async () => {
  // Select the first line of page 1 by dragging across its text layer.
  await page.locator('.pdfv__page-input').fill('1')
  const line = page.locator('.pdfViewer .page').first().locator('.textLayer span').first()
  await expect(line).toBeVisible({ timeout: 15_000 })
  const box = (await line.boundingBox())!
  await page.mouse.move(box.x + 1, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 1, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()

  await page.locator('button[aria-label="Quote the selection into a note"]').click()

  // Beside the document, named after it, with the words and a link back.
  await expect
    .poll(() => readFileSync(join(vault, 'Paper.md'), 'utf-8'), { timeout: 20_000 })
    .toContain('Orrery reads PDFs now.')
  const note = readFileSync(join(vault, 'Paper.md'), 'utf-8')
  expect(note).toContain('[[Paper.pdf#page=1]]')
  expect(note.split('\n').some((l) => l.startsWith('> '))).toBe(true)
})

test('a page with no text on it is offered for recognition', async () => {
  // A scan is a picture of writing: nothing to select, search or quote until
  // somebody reads it. The offer only appears when there is something to read.
  await expect(
    page.locator('button[aria-label="Recognise the text on scanned pages"]')
  ).toHaveCount(0)

  const scanPath = join(vault, 'Scan.pdf')
  writeFileSync(scanPath, makePdf({ pages: [['A page with words.'], []] }))
  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Scan.pdf' }).click()
  await expect(page.locator('.pdfv__count')).toHaveText('of 2', { timeout: 20_000 })

  const offer = page.locator('button[aria-label="Recognise the text on scanned pages"]')
  await expect(offer).toBeVisible({ timeout: 20_000 })
  await expect(offer).toHaveAttribute('title', /1 page here (has|have) no text/)
})

test('recognition runs offline, on the engine that ships with the app', async () => {
  // Tesseract fetches its worker, its wasm engine and its language data from a
  // CDN unless told otherwise, which for an offline app is three ways to fail.
  // The blank page here has nothing legible on it, so what this proves is the
  // part that breaks silently: the bundled engine loads, runs, and reports.
  writeFileSync(join(vault, 'Blank.pdf'), makePdf({ pages: [['A page with words.'], []] }))
  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Blank.pdf' }).click()
  const offer = page.locator('button[aria-label="Recognise the text on scanned pages"]')
  await expect(offer).toBeVisible({ timeout: 20_000 })

  await offer.click()
  await expect(page.locator('.toast__message')).toContainText(/Recognised|Nothing legible/, {
    timeout: 120_000
  })
})
