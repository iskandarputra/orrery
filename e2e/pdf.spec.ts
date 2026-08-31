import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Locator, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'
import { makePdf } from '../src/main/services/__fixtures__/make-pdf'
import { makePng } from '../src/main/services/__fixtures__/make-png'

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

test('a note written on the page is saved into the file', async () => {
  // The first write. pdf.js serialises the annotation as an incremental update
  // — the original bytes kept, the new objects appended — so what lands on disk
  // is the document somebody sent plus what was added to it.
  const notesPath = join(vault, 'Notes.pdf')
  writeFileSync(notesPath, makePdf({ pages: [['A page to write on.']] }))
  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Notes.pdf' }).click()
  await expect(page.locator('.pdfViewer .page').first()).toBeVisible({ timeout: 20_000 })
  // Nothing on it yet, so the annotation found after saving can only be the one
  // written here.
  await expect(page.locator('.annotationLayer section')).toHaveCount(0)
  const before = statSync(notesPath).mtimeMs

  await page.locator('button[aria-label="Text box"]').click()
  await expect(page.locator('button[aria-label="Text box"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  )

  const box = (await page.locator('.pdfViewer .page').first().boundingBox())!
  await page.mouse.click(box.x + 120, box.y + 120)
  await page.keyboard.type('written by a test')
  await page.keyboard.press('Escape')

  // Writing on the page makes the tab dirty, as editing a note does.
  await expect(page.locator('.tab--active .tab__dirty-dot')).toHaveCount(1, { timeout: 10_000 })

  await page.locator('button[aria-label="Save this document"]').click()
  await expect(page.locator('.tab--active .tab__dirty-dot')).toHaveCount(0, { timeout: 20_000 })

  // On disk, and a PDF annotation rather than a picture of one: another reader
  // can open this file and see the same note.
  expect(statSync(notesPath).mtimeMs).not.toBe(before)
  const bytes = readFileSync(notesPath, 'latin1')
  expect(bytes).toContain('/FreeText')
  // The original document is still in there: an incremental update appends.
  expect(bytes).toContain('A page to write on.')
})

test('the saved note is there when the document is opened again', async () => {
  await page.locator('.tab--active button[aria-label^="Close"]').click()
  await page.locator('.tree-row--file', { hasText: 'Notes.pdf' }).click()
  await expect(page.locator('.pdfViewer .page').first()).toBeVisible({ timeout: 20_000 })
  await expect(
    page.locator('.annotationLayer .freeText, .annotationLayer section').first()
  ).toBeVisible({ timeout: 20_000 })
})

test('a form can be filled in, and the answer is saved into the file', async () => {
  // Interactive fields were drawn but dead until there was a way to save them:
  // a box you can type into that forgets what you typed is worse than one you
  // cannot.
  const formPath = join(vault, 'Form.pdf')
  writeFileSync(
    formPath,
    makePdf({ pages: [['Please write your name below.']], textField: { name: 'fullName' } })
  )
  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Form.pdf' }).click()
  await expect(page.locator('.pdfViewer .page').first()).toBeVisible({ timeout: 20_000 })

  const field = page.locator('.annotationLayer input').first()
  await expect(field).toBeVisible({ timeout: 20_000 })
  await field.fill('Ada Lovelace')
  await field.blur()

  await expect(page.locator('.tab--active .tab__dirty-dot')).toHaveCount(1, { timeout: 10_000 })
  await page.locator('button[aria-label="Save this document"]').click()
  await expect(page.locator('.tab--active .tab__dirty-dot')).toHaveCount(0, { timeout: 20_000 })

  // In the file as the field's value, which is what any other PDF reader will
  // show — not baked into a picture of the page.
  await expect
    .poll(() => readFileSync(formPath, 'latin1'), { timeout: 10_000 })
    .toContain('Ada Lovelace')
})

test('the notes panel lists what is marked on the document', async () => {
  // A mark is attached to a place on a page, which is what you want while
  // reading and useless when the question is "what did I mark in this paper".
  await page.locator('.tree-row--file', { hasText: 'Notes.pdf' }).click()
  await expect(page.locator('.pdfViewer .page').first()).toBeVisible({ timeout: 20_000 })

  await page.locator('.pdfv__tab', { hasText: 'Notes' }).click()
  const mark = page.locator('.pdfv__mark')
  await expect(mark).toHaveCount(1, { timeout: 20_000 })
  await expect(mark.first()).toContainText('written by a test')
  await expect(mark.first()).toContainText('p1')

  // The count on the tab is the same number, so the panel is worth opening.
  await expect(page.locator('.pdfv__tab-count')).toHaveText('1')
})

test('pages can be rearranged, and the file says so afterwards', async () => {
  // The first structural write: this is not an annotation appended to a
  // document but a new document built from its pages.
  const pagesPath = join(vault, 'Pages.pdf')
  writeFileSync(
    pagesPath,
    makePdf({ pages: [['Page one alpha.'], ['Page two beta.'], ['Page three gamma.']] })
  )
  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Pages.pdf' }).click()
  await expect(page.locator('.pdfv__count')).toHaveText('of 3', { timeout: 20_000 })

  await page.locator('.pdfv__tab', { hasText: 'Pages' }).click()
  await expect(page.locator('.pdfv__thumb')).toHaveCount(3)

  // Take the first page out. Nothing is written until it is applied.
  await page.locator('.pdfv__thumb').first().click()
  await page.locator('button[aria-label="Remove pages"]').click()
  await expect(page.locator('.pdfv__thumb')).toHaveCount(2)
  const before = statSync(pagesPath).mtimeMs

  await page.locator('.pdfv__page-pending button', { hasText: 'Apply' }).click()
  await expect(page.locator('.pdfv__count')).toHaveText('of 2', { timeout: 30_000 })
  expect(statSync(pagesPath).mtimeMs).not.toBe(before)

  // Read back through the reader rather than out of the bytes: the writing
  // engine re-encodes the content streams, so the words are no longer a
  // substring of the file — and what matters is what a reader makes of it.
  const text = page.locator('.pdfViewer .page').first().locator('.textLayer')
  await expect(text).toContainText('Page two beta.', { timeout: 20_000 })
  await expect(page.locator('.pdfViewer')).not.toContainText('Page one alpha.')
})

test('pages can be taken out into a document of their own', async () => {
  // Stands on its own: opens the document and the rail rather than relying on
  // the test before it having left them open.
  await page.locator('.tree-row--file', { hasText: 'Pages.pdf' }).first().click()
  await expect(page.locator('.pdfv__count')).toHaveText('of 2', { timeout: 20_000 })
  await page.locator('.pdfv__tab', { hasText: 'Pages' }).click()
  await expect(page.locator('.pdfv__thumb')).toHaveCount(2, { timeout: 20_000 })

  await page.locator('.pdfv__thumb').first().click()
  await page.locator('button[aria-label="Extract pages"]').click()

  await expect
    .poll(() => existsSync(join(vault, 'Pages extract.pdf')), { timeout: 30_000 })
    .toBe(true)

  // Opened, it is exactly the page that was chosen and nothing else.
  await page.locator('.tree-row--file', { hasText: 'Pages extract.pdf' }).click()
  await expect(page.locator('.pdfv__count')).toHaveText('of 1', { timeout: 20_000 })
  await expect(page.locator('.pdfViewer .textLayer').first()).toContainText('Page two beta.', {
    timeout: 20_000
  })

  // And the document it came from still has both of its pages.
  await page.locator('.tree-row--file', { hasText: 'Pages.pdf' }).first().click()
  await expect(page.locator('.pdfv__count')).toHaveText('of 2', { timeout: 20_000 })
})

test('a document that positions every character still edits a line at a time', async () => {
  // The shape most real PDFs have, and the one that made the editor unusable
  // before it grouped: a page of a real letter of offer held 4,662 text
  // objects, one glyph each — four thousand boxes, and the most you could
  // retype was a single letter.
  const realPath = join(vault, 'PerChar.pdf')
  writeFileSync(
    realPath,
    makePdf({ pages: [['LETTER OF OFFER', 'Date: 24/06/2026']], perCharacter: true })
  )
  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'PerChar.pdf' }).click()
  await expect(page.locator('.pdfViewer .textLayer').first()).toContainText('LETTER OF OFFER', {
    timeout: 20_000
  })

  await page.locator('button[aria-label="Edit the page itself"]').click()
  // Two lines, not thirty-one characters.
  await expect(page.locator('.pdfv__object')).toHaveCount(2, { timeout: 20_000 })

  const first = (await page.locator('.pdfv__object').first().boundingBox())!
  await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2)
  const input = page.locator('.pdfv__object-input')
  await expect(input).toBeVisible()
  // The whole line is in hand, not one glyph of it.
  await expect(input).toHaveValue(/LETTER OF OFFER/)

  await input.fill('LETTER OF ACCEPTANCE')
  await input.press('Enter')
  // This little document has never drawn a P, a C or an N, so the editor asks
  // before writing letters its font may not have — which on a real document,
  // with a real document's alphabet, almost never comes up.
  await expect(page.locator('.pdfv__object-warning')).toBeVisible()
  await input.press('Enter')

  await expect(page.locator('.pdfViewer')).toContainText('LETTER OF ACCEPTANCE', {
    timeout: 30_000
  })
  // The other line is untouched. Matched loosely because a page that positions
  // every character leaves pdf.js to infer where the spaces are, and it puts a
  // few more in than the document meant — that is its reading of the page, not
  // a change to it.
  await expect(page.locator('.pdfViewer')).toContainText(/24\/\s*06\/\s*2026/)
})

test('a line of the document itself can be retyped', async () => {
  // Not an annotation on top of the page: the words on the page, in the
  // document's own font, at the position they were already in.
  const editPath = join(vault, 'Edit.pdf')
  writeFileSync(editPath, makePdf({ pages: [['the original wording', 'a second line']] }))
  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Edit.pdf' }).click()
  await expect(page.locator('.pdfViewer .textLayer').first()).toContainText(
    'the original wording',
    {
      timeout: 20_000
    }
  )

  await page.locator('button[aria-label="Edit the page itself"]').click()
  const boxes = page.locator('.pdfv__object')
  await expect(boxes).toHaveCount(2, { timeout: 20_000 })

  // Click the first line's box and retype it.
  const first = (await boxes.first().boundingBox())!
  await page.mouse.click(first.x + first.width / 2, first.y + first.height / 2)
  const input = page.locator('.pdfv__object-input')
  await expect(input).toBeVisible()
  await expect(input).toHaveValue('the original wording')
  await input.fill('the replacement wording')
  await input.press('Enter')

  // "replacement" needs a p and an m, which this document has never drawn, so
  // it says so instead of quietly producing a line with holes in it.
  const warning = page.locator('.pdfv__object-warning')
  await expect(warning).toBeVisible()
  await expect(warning).toContainText('p')
  await expect(warning).toContainText('Press Enter again')

  // Enter again is the answer: the font may well have the glyph.
  await input.press('Enter')

  // The page is re-read from the file, so this is what the document now says.
  await expect(page.locator('.pdfViewer .textLayer').first()).toContainText(
    'the replacement wording',
    { timeout: 30_000 }
  )
  await expect(page.locator('.pdfViewer')).not.toContainText('the original wording')
  // And the line beside it is untouched.
  await expect(page.locator('.pdfViewer')).toContainText('a second line')
})

test('something can be taken out of the document, not merely covered', async () => {
  // The difference between redaction and a black rectangle: a covered word is
  // still in the file for anyone who selects the text or reads the bytes.
  const boxes = page.locator('.pdfv__object')
  await expect(boxes).toHaveCount(2, { timeout: 20_000 })
  const second = (await boxes.nth(1).boundingBox())!
  await page.mouse.click(second.x + second.width / 2, second.y + second.height / 2)

  await page.locator('button[aria-label="Remove this from the page"]').click()
  await expect(page.locator('.pdfViewer')).not.toContainText('a second line', { timeout: 30_000 })
  await expect(page.locator('.pdfViewer')).toContainText('the replacement wording')
})

test('the pages fill the height they are given', async () => {
  // The viewer is a column: a toolbar, sometimes a find bar, and the pages
  // taking whatever is left. When that last row is sized to its content rather
  // than to the space, the document sits in a short box with the theme's
  // background below it — most visible on a large window, which is exactly
  // when somebody has made the window large in order to read.
  await page.locator('.tree-row--file', { hasText: 'Paper.pdf' }).click()
  await expect(page.locator('.pdfViewer .page').first()).toBeVisible({ timeout: 20_000 })

  const measured = await page.evaluate(() => {
    const root = document.querySelector('.pdfv')!.getBoundingClientRect()
    const bar = document.querySelector('.pdfv__bar')!.getBoundingClientRect()
    const host = document.querySelector('.pdfv__scroll-host')!.getBoundingClientRect()
    return { available: root.height - bar.height, used: host.height }
  })
  expect(measured.used).toBeGreaterThan(measured.available - 2)
})

test('a change to the document can be taken back, and made again', async () => {
  // Every change here rewrites the whole file, so undo cannot be a stack of
  // edits in memory — and without it, retyping the wrong line is permanent.
  const undoPath = join(vault, 'Undo.pdf')
  writeFileSync(undoPath, makePdf({ pages: [['words before the change']] }))
  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Undo.pdf' }).click()
  await expect(page.locator('.pdfViewer .textLayer').first()).toContainText('words before', {
    timeout: 20_000
  })
  await expect(page.locator('button[aria-label="Undo"]')).toBeDisabled()

  await page.locator('button[aria-label="Edit the page itself"]').click()
  const box = (await page.locator('.pdfv__object').first().boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  const input = page.locator('.pdfv__object-input')
  await expect(input).toBeVisible()
  await input.fill('words after the change')
  await input.press('Enter')
  await expect(page.locator('.pdfViewer')).toContainText('words after the change', {
    timeout: 30_000
  })

  // Back: the document says what it said before.
  await expect(page.locator('button[aria-label="Undo"]')).toBeEnabled({ timeout: 20_000 })
  await page.locator('button[aria-label="Undo"]').click()
  await expect(page.locator('.pdfViewer')).toContainText('words before the change', {
    timeout: 30_000
  })
  await expect(page.locator('.pdfViewer')).not.toContainText('words after the change')

  // And forward again.
  await expect(page.locator('button[aria-label="Redo"]')).toBeEnabled({ timeout: 20_000 })
  await page.locator('button[aria-label="Redo"]').click()
  await expect(page.locator('.pdfViewer')).toContainText('words after the change', {
    timeout: 30_000
  })
})

test('Ctrl+Z undoes on a PDF tab, where the editor has no say', async () => {
  // The editor's undo belongs to CodeMirror and only fires while a text
  // document has focus; this surface has to take the keystroke itself.
  await page.locator('.pdfv').click({ position: { x: 8, y: 8 } })
  await page.keyboard.press('Control+z')
  await expect(page.locator('.pdfViewer')).toContainText('words before the change', {
    timeout: 30_000
  })
})

test('rearranging pages can be taken back too', async () => {
  // Not only the content edits: a page removed by mistake is the change people
  // most want back.
  const pagesPath = join(vault, 'Undo2.pdf')
  writeFileSync(pagesPath, makePdf({ pages: [['alpha page'], ['beta page']] }))
  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Undo2.pdf' }).click()
  await expect(page.locator('.pdfv__count')).toHaveText('of 2', { timeout: 20_000 })

  await page.locator('.pdfv__tab', { hasText: 'Pages' }).click()
  await page.locator('.pdfv__thumb').first().click()
  await page.locator('button[aria-label="Remove pages"]').click()
  await page.locator('.pdfv__page-pending button', { hasText: 'Apply' }).click()
  await expect(page.locator('.pdfv__count')).toHaveText('of 1', { timeout: 30_000 })

  await page.locator('button[aria-label="Undo"]').click()
  await expect(page.locator('.pdfv__count')).toHaveText('of 2', { timeout: 30_000 })
  await expect(page.locator('.pdfViewer')).toContainText('alpha page')
})

test('something on the page can be dragged somewhere else', async () => {
  const movePath = join(vault, 'Move.pdf')
  writeFileSync(movePath, makePdf({ pages: [['a line that will be moved']] }))
  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Move.pdf' }).click()
  await expect(page.locator('.pdfViewer .textLayer').first()).toContainText('will be moved', {
    timeout: 20_000
  })
  await page.locator('button[aria-label="Edit the page itself"]').click()
  const box = page.locator('.pdfv__object').first()
  await expect(box).toBeVisible({ timeout: 20_000 })
  const before = (await box.boundingBox())!

  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 + 60, before.y + before.height / 2 + 40, {
    steps: 10
  })
  await page.mouse.up()

  // The document is rewritten and re-read, so this is where it now sits.
  await expect
    .poll(async () => (await page.locator('.pdfv__object').first().boundingBox())?.x ?? 0, {
      timeout: 30_000
    })
    .toBeGreaterThan(before.x + 40)
  await expect(page.locator('.pdfViewer')).toContainText('a line that will be moved')
})

test('new text can be written onto the page', async () => {
  // Not an annotation on top: an object in the page's own content, in a font
  // every reader has, so it draws anywhere.
  const writePath = join(vault, 'Write.pdf')
  writeFileSync(writePath, makePdf({ pages: [['a page with room on it']] }))
  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Write.pdf' }).click()
  await expect(page.locator('.pdfViewer .textLayer').first()).toContainText('room on it', {
    timeout: 20_000
  })
  await page.locator('button[aria-label="Edit the page itself"]').click()

  const layer = page.locator('.pdfv__objects')
  await expect(layer).toBeVisible({ timeout: 20_000 })
  // Well inside the page: text does not wrap — a PDF has nowhere to wrap to —
  // so a line started at the edge runs off it, and pdf.js does not report the
  // part that is no longer on the page.
  const host = (await layer.boundingBox())!
  await page.mouse.dblclick(host.x + host.width * 0.25, host.y + host.height * 0.6)

  const input = page.locator('input[aria-label="Write on the page"]')
  await expect(input).toBeVisible()
  await input.fill('written onto the page')
  await input.press('Enter')

  await expect(page.locator('.pdfViewer')).toContainText('written onto the page', {
    timeout: 30_000
  })
  // And it is really in the document: undo takes it away again.
  await page.locator('button[aria-label="Undo"]').click()
  await expect(page.locator('.pdfViewer')).not.toContainText('written onto the page', {
    timeout: 30_000
  })
})

test('an object can be made bigger by dragging its corner', async () => {
  const sizePath = join(vault, 'Size.pdf')
  writeFileSync(sizePath, makePdf({ pages: [['a line to stretch']] }))
  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Size.pdf' }).click()
  await expect(page.locator('.pdfViewer .textLayer').first()).toContainText('to stretch', {
    timeout: 20_000
  })
  await page.locator('button[aria-label="Edit the page itself"]').click()

  const box = page.locator('.pdfv__object').first()
  await expect(box).toBeVisible({ timeout: 20_000 })
  const before = (await box.boundingBox())!
  // Pick it first: the handle only appears on the object in hand.
  await page.mouse.click(before.x + before.width / 2, before.y + before.height / 2)

  const handle = page.locator('.pdfv__object-handle')
  await expect(handle).toBeVisible()
  const grip = (await handle.boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x + 80, grip.y + 20, { steps: 10 })
  await page.mouse.up()

  // Wider on the page, and still saying the same thing.
  await expect
    .poll(async () => (await page.locator('.pdfv__object').first().boundingBox())?.width ?? 0, {
      timeout: 30_000
    })
    .toBeGreaterThan(before.width + 30)
  await expect(page.locator('.pdfViewer')).toContainText('a line to stretch')
})

test('pages can be dragged into a different order', async () => {
  const orderPath = join(vault, 'Order.pdf')
  writeFileSync(orderPath, makePdf({ pages: [['first page here'], ['second page here']] }))
  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Order.pdf' }).click()
  await expect(page.locator('.pdfv__count')).toHaveText('of 2', { timeout: 20_000 })
  await page.locator('.pdfv__tab', { hasText: 'Pages' }).click()

  const thumbs = page.locator('.pdfv__thumb')
  await expect(thumbs).toHaveCount(2)
  await thumbs.nth(1).dragTo(thumbs.nth(0))

  // Rearranged in the rail, and not yet in the file: nothing is written until
  // it is applied.
  await expect(page.locator('.pdfv__page-pending')).toBeVisible()
  await page.locator('.pdfv__page-pending button', { hasText: 'Apply' }).click()

  await expect(page.locator('.pdfViewer .page').first().locator('.textLayer')).toContainText(
    'second page here',
    { timeout: 30_000 }
  )
})

test('another document can be added to the end of this one', async () => {
  // Merging is the same path as any other rearrangement — one plan, one write —
  // with a second document named as a further source.
  const intoPath = join(vault, 'Into.pdf')
  const fromPath = join(vault, 'From.pdf')
  writeFileSync(intoPath, makePdf({ pages: [['the original document']] }))
  writeFileSync(fromPath, makePdf({ pages: [['the added document']] }))

  // The file picker is a native dialog, so it is answered from the main
  // process rather than clicked.
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () =>
      ({ canceled: false, filePaths: [chosen] }) as unknown as ReturnType<
        typeof dialog.showOpenDialog
      > extends Promise<infer R>
        ? R
        : never
  }, fromPath)

  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Into.pdf' }).click()
  await expect(page.locator('.pdfv__count')).toHaveText('of 1', { timeout: 20_000 })

  await page.locator('.pdfv__tab', { hasText: 'Pages' }).click()
  await page.locator('button[aria-label="Add pages from another PDF"]').click()

  await expect(page.locator('.pdfv__count')).toHaveText('of 2', { timeout: 30_000 })
  await expect(page.locator('.pdfViewer')).toContainText('the original document', {
    timeout: 20_000
  })
  await expect(page.locator('.pdfViewer')).toContainText('the added document')

  // The document it came from is untouched.
  await page.locator('.tree-row--file', { hasText: 'From.pdf' }).click()
  await expect(page.locator('.pdfv__count')).toHaveText('of 1', { timeout: 20_000 })
})

test('a shape bigger than the page is not offered as something to edit', async () => {
  // What a real letter of offer contained: a path 2,250 points tall on a
  // 792-point page — a clipping path rather than a thing on the page. Drawn as
  // a box it covered the document, and picking it opened an edit panel across
  // the whole page, which is what "the editor goes blank" turned out to be.
  const clipPath = join(vault, 'Clip.pdf')
  writeFileSync(clipPath, makePdf({ pages: [['a normal line of text']], hugePath: true }))
  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Clip.pdf' }).click()
  await expect(page.locator('.pdfViewer .textLayer').first()).toContainText('a normal line', {
    timeout: 20_000
  })

  await page.locator('button[aria-label="Edit the page itself"]').click()
  const boxes = page.locator('.pdfv__object')
  await expect(boxes).toHaveCount(1, { timeout: 20_000 })

  // And what is offered fits on the page.
  const pageBox = (await page.locator('.pdfViewer .page').first().boundingBox())!
  const box = (await boxes.first().boundingBox())!
  expect(box.height).toBeLessThan(pageBox.height)
})

test('an edit keeps the zoom, the page and where you were reading', async () => {
  // The whole reader used to be rebuilt after every change: the pages vanished
  // while a large document re-rendered — which reads as the viewer going black
  // — and the zoom fell back to automatic, because a new viewer knows nothing
  // about the old one. Editing something should change that thing and nothing
  // else about where you are.
  const keepPath = join(vault, 'Keep.pdf')
  writeFileSync(
    keepPath,
    makePdf({ pages: [['a line to change', 'and another line'], ['the second page']] })
  )
  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Keep.pdf' }).click()
  await expect(page.locator('.pdfViewer .textLayer').first()).toContainText('a line to change', {
    timeout: 20_000
  })

  await page.locator('button[aria-label="Zoom in"]').click()
  await page.locator('button[aria-label="Zoom in"]').click()
  const zoom = await page.locator('.pdfv__zoom').textContent()

  await page.locator('button[aria-label="Edit the page itself"]').click()
  const box = page.locator('.pdfv__object').first()
  await expect(box).toBeVisible({ timeout: 20_000 })
  const spot = (await box.boundingBox())!
  await page.mouse.click(spot.x + spot.width / 2, spot.y + spot.height / 2)
  const input = page.locator('.pdfv__object-input')
  await expect(input).toBeVisible()
  await input.fill('a line that changed')
  await input.press('Enter')

  await expect(page.locator('.pdfViewer')).toContainText('a line that changed', {
    timeout: 30_000
  })
  // The zoom is where it was left, not back at automatic.
  await expect(page.locator('.pdfv__zoom')).toHaveText(zoom ?? '')
  // And the pages are still on screen: nothing was torn down to do it.
  await expect(page.locator('.pdfViewer .page')).toHaveCount(2)
  await expect(page.locator('.pdfViewer')).toContainText('and another line')
})

test('a picture can be put on a page', async () => {
  // pdf.js's stamp tool cannot be driven from its viewer components — there is
  // no way to choose a file — so the button used to arm and clicking the page
  // did nothing at all. This puts a real image object on the page instead.
  const withPic = join(vault, 'Picture.pdf')
  const png = join(vault, 'stamp.png')
  writeFileSync(withPic, makePdf({ pages: [['a page to decorate']] }))
  writeFileSync(png, makePng(64, 64))

  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] }) as never
  }, png)

  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Picture.pdf' }).click()
  await expect(page.locator('.pdfViewer .page').first()).toBeVisible({ timeout: 20_000 })

  await page.locator('button[aria-label="Image"]').click()
  await expect(page.locator('.toast__message')).toContainText('picture was added', {
    timeout: 30_000
  })

  // In the page's own content, where the editor can find it — and the words
  // that were there are untouched.
  await page.locator('button[aria-label="Edit the page itself"]').click()
  await expect
    .poll(
      async () => {
        const objects = await page.evaluate(
          (p) => window.orrery.invoke('pdf:objects', { path: p, page: 0 }),
          withPic
        )
        return objects.filter((o) => o.kind === 'image').length
      },
      { timeout: 20_000 }
    )
    .toBe(1)
  await expect(page.locator('.pdfViewer')).toContainText('a page to decorate')
})

test('the page can be turned and still edited', async () => {
  // Rotation and editing were built without knowing about each other. Turned a
  // quarter, the drawn page's width is the page's height, so every box was
  // measured against the wrong side and placed along the wrong axis — and since
  // a click picks whatever box is under it, clicking a word retyped a different
  // one. The check is the one that matters to somebody using it: click the
  // words you can see, and get those words.
  const turned = join(vault, 'Turned.pdf')
  writeFileSync(turned, makePdf({ pages: [['LETTER OF OFFER', 'Date: 24/06/2026']] }))
  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Turned.pdf' }).click()
  await expect(page.locator('.pdfViewer:visible .textLayer').first()).toContainText(
    'LETTER OF OFFER',
    { timeout: 20_000 }
  )

  await page.locator('button[aria-label="Rotate the pages"]').click()
  await page.locator('button[aria-label="Edit the page itself"]').click()
  await expect(page.locator('.pdfv__object:visible')).toHaveCount(2, { timeout: 20_000 })

  // Where pdf.js actually drew the words, on the page as it now stands.
  //
  // Scoped to the pane on screen: the earlier tabs in this file are still open
  // behind this one and one of those documents says the same words, so without
  // the filter this measures a hidden tab and compares two different pages.
  const drawn = (await page
    .locator('.pdfViewer:visible .textLayer span', { hasText: 'LETTER OF OFFER' })
    .first()
    .boundingBox())!
  await page.mouse.click(drawn.x + drawn.width / 2, drawn.y + drawn.height / 2)

  const input = page.locator('.pdfv__object-input')
  await expect(input).toBeVisible()
  await expect(input).toHaveValue(/LETTER OF OFFER/)

  // And the editor's box lies over that word rather than somewhere else on the
  // page. Both are measured again here, together: picking a line opens a panel
  // and the pages settle a little, so a rectangle read before the click and one
  // read after it are answers about two different layouts.
  const box = (await page.locator('.pdfv__object--picked:visible').boundingBox())!
  const word = (await page
    .locator('.pdfViewer:visible .textLayer span', { hasText: 'LETTER OF OFFER' })
    .first()
    .boundingBox())!
  const middle = { x: word.x + word.width / 2, y: word.y + word.height / 2 }
  expect(middle.x).toBeGreaterThanOrEqual(box.x - 4)
  expect(middle.x).toBeLessThanOrEqual(box.x + box.width + 4)
  expect(middle.y).toBeGreaterThanOrEqual(box.y - 4)
  expect(middle.y).toBeLessThanOrEqual(box.y + box.height + 4)
  // Turned on its side, a line of text runs down the page rather than across.
  expect(box.height).toBeGreaterThan(box.width)

  // And the edit itself keeps the page turned. Handing the viewer a rewritten
  // document resets its rotation, so without putting the turn back the page
  // sprang upright while the editor went on placing boxes on its side.
  const before = (await page.locator('.pdfViewer:visible .page').boundingBox())!
  expect(before.width).toBeGreaterThan(before.height)
  await input.fill('LETTER OF ACCEPTANCE')
  await input.press('Enter')
  await input.press('Enter') // the font warning: this little document has no P
  await expect(page.locator('.pdfViewer:visible')).toContainText('LETTER OF ACCEPTANCE', {
    timeout: 20_000
  })
  await expect
    .poll(
      async () => {
        const after = await page.locator('.pdfViewer:visible .page').boundingBox()
        return after ? after.width > after.height : false
      },
      { timeout: 20_000 }
    )
    .toBe(true)
})

test('the editor follows the reader to another page', async () => {
  // The boxes are drawn over one page at a time and positioned against that
  // page's place in the scroller, so the page somebody has scrolled to is the
  // page they can edit — not the first one, forever.
  const many = join(vault, 'Chapters.pdf')
  writeFileSync(
    many,
    makePdf({ pages: [['page one speaks'], ['page two speaks'], ['page three speaks']] })
  )
  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Chapters.pdf' }).click()
  await expect(page.locator('.pdfViewer:visible .textLayer').first()).toContainText(
    'page one speaks',
    { timeout: 20_000 }
  )

  await page.locator('button[aria-label="Edit the page itself"]').click()
  await expect(page.locator('.pdfv__object:visible')).toHaveCount(1, { timeout: 20_000 })

  await page.locator('.pdfv__page-input').fill('3')
  await page.locator('.pdfv__page-input').press('Enter')

  const box = page.locator('.pdfv__object:visible').first()
  await expect(box).toHaveAttribute('title', /page three speaks/, { timeout: 20_000 })

  // Over the third page, not left behind on the first.
  const third = (await page
    .locator('.pdfViewer:visible .page[data-page-number="3"]')
    .boundingBox())!
  const drawn = (await box.boundingBox())!
  expect(drawn.y).toBeGreaterThanOrEqual(third.y - 4)
  expect(drawn.y).toBeLessThanOrEqual(third.y + third.height + 4)
})

test('the boxes stay on the words when the page is zoomed', async () => {
  // Measured once when the layer opened, every box drifted off its word the
  // first time somebody zoomed in to read what they were editing. It is
  // measured again whenever the drawn page changes size; this is the guard.
  const zoomed = join(vault, 'Zoomed.pdf')
  writeFileSync(zoomed, makePdf({ pages: [['a line worth editing']] }))
  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Zoomed.pdf' }).click()
  await expect(page.locator('.pdfViewer:visible .textLayer').first()).toContainText(
    'a line worth editing',
    { timeout: 20_000 }
  )

  await page.locator('button[aria-label="Edit the page itself"]').click()
  const box = page.locator('.pdfv__object:visible').first()
  await expect(box).toBeVisible({ timeout: 20_000 })
  const before = (await box.boundingBox())!

  await page.locator('button[aria-label="Zoom in"]').click()
  await page.locator('button[aria-label="Zoom in"]').click()
  // Bigger, because the page is bigger — not the same box over larger words.
  await expect
    .poll(async () => (await box.boundingBox())?.width ?? 0, { timeout: 20_000 })
    .toBeGreaterThan(before.width * 1.2)

  const word = (await page
    .locator('.pdfViewer:visible .textLayer span', { hasText: 'a line worth editing' })
    .first()
    .boundingBox())!
  const after = (await box.boundingBox())!
  const middle = { x: word.x + word.width / 2, y: word.y + word.height / 2 }
  expect(middle.x).toBeGreaterThanOrEqual(after.x - 4)
  expect(middle.x).toBeLessThanOrEqual(after.x + after.width + 4)
  expect(middle.y).toBeGreaterThanOrEqual(after.y - 4)
  expect(middle.y).toBeLessThanOrEqual(after.y + after.height + 4)
})

/** The rectangle of something, once it has one. */
async function boxOf(target: Locator): Promise<{
  x: number
  y: number
  width: number
  height: number
}> {
  // Each edit rewrites the file and remounts the layer over the page. A box
  // asked for mid-swap comes back null — and worse, one measured on an element
  // that is about to be replaced hands back a rectangle to press on with no
  // handler behind it any more, which is a drag that quietly does nothing.
  //
  // So: wait for a rectangle that has stopped moving. Two identical readings
  // mean the remount is over, and what is on screen will still be there when
  // the mouse goes down.
  await expect(target).toBeVisible({ timeout: 20_000 })
  let box: { x: number; y: number; width: number; height: number } | null = null
  let last = ''
  await expect
    .poll(
      async () => {
        const now = await target.boundingBox()
        if (!now || now.width === 0 || now.height === 0) {
          last = ''
          return false
        }
        const here = `${now.x},${now.y},${now.width},${now.height}`
        const settled = here === last
        last = here
        box = now
        return settled
      },
      { timeout: 20_000, intervals: [120] }
    )
    .toBe(true)
  return box!
}

test('a picture that has been added can be dragged, resized and turned', async () => {
  // The complaint this comes from: the picture landed, the toast said "drag it
  // where you want it", and nothing could be dragged. Adding one left the page
  // editor switched off, so nothing on the page had handles — the engine held
  // the image and the screen offered no way to touch it.
  //
  // Exercised on a picture rather than on a line of text, because they are
  // different objects taking different paths through the editor.
  const target = join(vault, 'Handled.pdf')
  const png = join(vault, 'handle.png')
  writeFileSync(target, makePdf({ pages: [['a page to decorate']] }))
  writeFileSync(png, makePng(64, 64))
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] }) as never
  }, png)

  await page.locator('.sidebar__actions button[title*="Refresh"]').click()
  await page.locator('.tree-row--file', { hasText: 'Handled.pdf' }).click()
  await expect(page.locator('.pdfViewer:visible .page').first()).toBeVisible({ timeout: 20_000 })

  await page.locator('button[aria-label="Image"]').click()
  await expect(page.locator('.toast__message')).toContainText('picture was added', {
    timeout: 30_000
  })

  // The editor is on without anybody having to go and find it, because the
  // toast just told them to drag something.
  await expect(page.locator('button[aria-label="Edit the page itself"]')).toHaveAttribute(
    'aria-pressed',
    'true'
  )

  const picture = async (): Promise<{ left: number; bottom: number; width: number }> => {
    const objects = await page.evaluate(
      (p) => window.orrery.invoke('pdf:objects', { path: p, page: 0 }),
      target
    )
    const found = objects.find((o) => o.kind === 'image')!
    return {
      left: found.bounds.left,
      bottom: found.bounds.bottom,
      width: found.bounds.right - found.bounds.left
    }
  }
  const before = await picture()

  // Named by what it is rather than by position: the page holds a line of text
  // as well, and which of the two comes first is the engine's business. Not by
  // title — the tooltip service takes that attribute away while the pointer is
  // over the box, so a selector reading it finds nothing mid-drag.
  const stamp = page.locator('.pdfv__object[data-kind="image"]:visible')

  // It arrives picked, so the handles are already there — nobody has to work
  // out that the thing they just placed needs clicking before it can be sized.
  await expect(stamp).toHaveClass(/pdfv__object--picked/)
  await expect(page.locator('.pdfv__object-turn')).toBeVisible()

  const start = await boxOf(stamp)
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(start.x + start.width / 2 + 60, start.y + start.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect
    .poll(async () => (await picture()).left, { timeout: 20_000 })
    .toBeGreaterThan(before.left + 20)

  // Turning it. The handle sits above whatever is picked.
  const moved = page.locator('.pdfv__object[data-kind="image"]:visible')
  const put = await boxOf(moved)
  await page.mouse.click(put.x + put.width / 2, put.y + put.height / 2)
  const turn = page.locator('.pdfv__object-turn')
  const grip = await boxOf(turn)
  const middle = await boxOf(moved)
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  // Round to the right of the object's middle: a quarter turn clockwise.
  await page.mouse.move(middle.x + middle.width / 2 + 120, middle.y + middle.height / 2, {
    steps: 10
  })
  await page.mouse.up()
  await expect(page.locator('.toast__message')).not.toContainText('could not be turned')

  // Resizing it, by the corner grip on the picked object.
  const wide = (await picture()).width
  const again = page.locator('.pdfv__object[data-kind="image"]:visible')
  const spot = await boxOf(again)
  await page.mouse.click(spot.x + spot.width / 2, spot.y + spot.height / 2)
  const handle = page.locator('.pdfv__object-handle')
  const grab = await boxOf(handle)
  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2)
  await page.mouse.down()
  await page.mouse.move(grab.x + grab.width / 2 + 70, grab.y + grab.height / 2 + 70, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await picture()).width, { timeout: 20_000 }).toBeGreaterThan(wide)

  // And the words underneath were never touched by any of it.
  await expect(page.locator('.pdfViewer:visible')).toContainText('a page to decorate')
})
