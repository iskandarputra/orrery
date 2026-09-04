import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * An HTML file, read as the page it is.
 *
 * The editor opens one as source, which is right for changing it and no answer
 * at all for looking at it. This is the other half of that: the same buffer,
 * rendered, and back again.
 *
 * Most of what is checked here cannot be checked anywhere else. That the page's
 * own stylesheet loaded, that its script did not run, that the picture it links
 * to on the internet was not fetched — none of those are facts about a string
 * this app builds. They are facts about what a browser did with it, and the
 * only place to find them out is in a browser.
 */

/**
 * A page that says out loud whether each thing worked, and would say so loudly
 * if the script ran.
 */
const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Reader check</title>
    <link rel="stylesheet" href="site.css" />
    <style>
      .inline { letter-spacing: 4px; }
    </style>
  </head>
  <body>
    <h1>Reader check</h1>
    <p class="inline">spaced by the inline style block</p>
    <div class="card">styled by the file's own stylesheet</div>
    <p><img id="local" src="logo.png" alt="local" /></p>
    <p><img id="remote" src="https://example.invalid/tracker.png" alt="remote" /></p>
    <p id="ran">scripts did not run</p>
    <script>
      document.getElementById('ran').textContent = 'SCRIPTS RAN'
      document.body.setAttribute('data-script-ran', 'yes')
    </script>
  </body>
</html>
`

const STYLESHEET = '.card { background-color: rgb(240, 230, 210); }\n'

/**
 * A page that draws itself with libraries the reader will not run.
 *
 * Mermaid and MathJax are how a technical page carries a diagram and an
 * equation, and a reader that runs no scripts shows both as the raw text they
 * were written as — which is a preview of the page's plumbing rather than of
 * the page. The app draws them itself instead, out here, and hands the frame
 * the finished picture.
 */
const RICH = `<!doctype html>
<html><head><meta charset="utf-8"><title>Rich</title>
<script src="https://cdn.example/mermaid.min.js"></script>
<script src="https://cdn.example/tex-mml-chtml.js"></script>
</head><body>
<h1 id="top">Rich</h1>
<nav><a id="jump" href="#far">jump to the bottom</a></nav>
<pre class="mermaid">graph TD
  A[Start] --> B[End]
</pre>
<p>Inline \\(E = mc^2\\) and a display one:</p>
<p>$$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$</p>
<p>A price list must survive: it costs $5 to $10.</p>
<div style="height:1600px">spacer</div>
<h2 id="far">Far below</h2>
</body></html>
`

/** 48×48 solid PNG, so a picture that loads has a size to prove it by. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAOklEQVRoge3OMQEAAAgDoC251a3gLzRgcncpAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+DcW7q0BAdxJ2u0AAAAASUVORK5CYII=',
  'base64'
)

let app: ElectronApplication
let page: Page
let vault: string

/** The rendered page, reached through the sandboxed frame showing it. */
const rendered = (): ReturnType<Page['frameLocator']> => page.frameLocator('.htmlv__frame')

async function runCommand(commandId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

const openFile = async (name: string): Promise<void> => {
  await page.locator('.tree-row--file', { hasText: name }).click()
  await expect(page.locator('.tab', { hasText: name })).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(300)
}

const read = async (heading = 'Reader check'): Promise<void> => {
  await page.locator('.header-viewmode__btn', { hasText: 'Read' }).click()
  await expect(page.locator('.htmlv__frame')).toBeVisible({ timeout: 15_000 })
  // The frame has to finish loading before anything inside it can be measured,
  // and its own heading is the thing that says this is the right page in it.
  await expect(rendered().locator('h1')).toHaveText(heading, { timeout: 20_000 })
}

const edit = async (): Promise<void> => {
  await page.locator('.header-viewmode__btn', { hasText: 'Edit' }).click()
  await expect(page.locator('.htmlv')).toHaveCount(0)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-html-'))
  writeFileSync(join(vault, 'page.html'), PAGE)
  writeFileSync(join(vault, 'site.css'), STYLESHEET)
  writeFileSync(join(vault, 'logo.png'), PNG)
  writeFileSync(join(vault, 'plain.htm'), '<h1>A second page</h1>')
  writeFileSync(join(vault, 'rich.html'), RICH)
  writeFileSync(join(vault, 'Note.md'), '# Note\n\nSome prose.\n')

  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1300, height: 900 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Note.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('opens an html file as source, not as a page', async () => {
  await openFile('page.html')
  // The editor, with the file's own text in it — the reader is a mode you ask
  // for, not what happens to every html file in the tree.
  await expect(page.locator('.cm-content')).toContainText('<!doctype html>')
  await expect(page.locator('.htmlv')).toHaveCount(0)
})

test('offers the choice, and only for a file that has two views', async () => {
  await openFile('page.html')
  await expect(page.locator('.header-viewmode__btn', { hasText: 'Read' })).toBeVisible()
  // A note has its own three-way switch; what must not appear is this one's
  // two-way switch over a file with nothing to render.
  await openFile('Note.md')
  await expect(page.locator('.header-viewmode__btn', { hasText: 'Hybrid' })).toBeVisible()
})

test('renders the page, with the styles the file itself brings', async () => {
  await openFile('page.html')
  await read()

  // The file's own stylesheet, fetched over orrery-asset: from beside it.
  await expect(rendered().locator('.card')).toHaveCSS('background-color', 'rgb(240, 230, 210)')
  // The block inside the document.
  await expect(rendered().locator('.inline')).toHaveCSS('letter-spacing', '4px')
})

test('resolves a relative picture against the file’s own folder', async () => {
  await openFile('page.html')
  await read()
  const width = await rendered()
    .locator('#local')
    .evaluate((img) => (img as HTMLImageElement).naturalWidth)
  expect(width).toBe(48)
})

test('does not run the page’s scripts', async () => {
  await openFile('page.html')
  await read()
  await expect(rendered().locator('#ran')).toHaveText('scripts did not run')
  await expect(rendered().locator('body')).not.toHaveAttribute('data-script-ran', 'yes')
  await expect(page.locator('.htmlv__note', { hasText: 'Scripts are not run' })).toBeVisible()
})

test('fetches nothing from the internet until it is asked to', async () => {
  await openFile('page.html')
  await read()
  const width = await rendered()
    .locator('#remote')
    .evaluate((img) => (img as HTMLImageElement).naturalWidth)
  expect(width).toBe(0)
  await expect(page.locator('.htmlv__action', { hasText: /Load 1 remote/ })).toBeVisible()
})

test('shows what is in the buffer, not what is on disk', async () => {
  await openFile('page.html')
  // Reading mode is remembered per buffer, so a previous test may have left
  // this one showing the page rather than the source it is about to type into.
  await edit()
  // Type into the source, then look at the page without saving.
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('<p id="unsaved">typed but not saved</p>')
  await read()
  await expect(rendered().locator('#unsaved')).toHaveText('typed but not saved')

  await edit()
  // The document is still the one that was open, edits and all: reading it was
  // a way of looking at the buffer, not a different buffer.
  await expect(page.locator('.cm-content')).toContainText('typed but not saved')
  await expect(page.locator('.tab__close--dirty')).toHaveCount(1)
  await runCommand('file.save')
  await page.waitForTimeout(400)
})

test('is a decision about one file, not about every file', async () => {
  await openFile('page.html')
  await read()
  // A second html file opens as source, even with the first one being read.
  await openFile('plain.htm')
  await expect(page.locator('.cm-content')).toContainText('A second page')
  await expect(page.locator('.htmlv')).toHaveCount(0)
  // And going back finds the first one still being read.
  await openFile('page.html')
  await expect(page.locator('.htmlv__frame')).toBeVisible()
})

test('leaves the markdown view mode alone', async () => {
  await openFile('page.html')
  await read()
  await openFile('Note.md')
  // The vault was opened in hybrid; reading a web page must not have changed
  // how prose opens.
  const mode = await page.evaluate(
    async () => (await window.orrery.invoke('settings:get', undefined)).editor.viewMode
  )
  expect(mode).toBe('live')
  await expect(page.locator('.header-viewmode__btn--active')).toHaveText(/Hybrid/)
})

test('goes back to the source from inside the reader', async () => {
  await openFile('page.html')
  await read()
  await page.locator('.htmlv__action', { hasText: 'Edit' }).click()
  await expect(page.locator('.htmlv')).toHaveCount(0)
  await expect(page.locator('.cm-content')).toContainText('<!doctype html>')
})

test('toggles from the command the menu dispatches', async () => {
  await openFile('page.html')
  await runCommand('view.toggleHtmlPreview')
  await expect(page.locator('.htmlv__frame')).toBeVisible({ timeout: 15_000 })
  await runCommand('view.toggleHtmlPreview')
  await expect(page.locator('.htmlv')).toHaveCount(0)
})

test('draws a diagram the page would have drawn with a script', async () => {
  await openFile('rich.html')
  await read('Rich')
  // An SVG, not the `graph TD` it was written as.
  await expect(rendered().locator('.mermaid svg')).toBeVisible({ timeout: 20_000 })
  await expect(rendered().locator('body')).not.toContainText('graph TD')
  await expect(page.locator('.htmlv__note', { hasText: /1 diagram drawn/ })).toBeVisible()
})

test('typesets the maths, and leaves the prices alone', async () => {
  await openFile('rich.html')
  await read('Rich')
  // KaTeX to MathML, which the browser draws out of the markup — no stylesheet
  // and no webfonts, neither of which the frame could reach.
  await expect(rendered().locator('math').first()).toBeVisible({ timeout: 20_000 })
  await expect(rendered().locator('body')).not.toContainText('$$')
  // This page loads MathJax without configuring `$…$`, which is MathJax's own
  // default — so a sentence about money stays a sentence. A reader that
  // assumed the single dollar would turn every price list into equations.
  await expect(rendered().locator('body')).toContainText('it costs $5 to $10')
})

test('an in-page link scrolls instead of doing nothing', async () => {
  await openFile('rich.html')
  await read('Rich')
  const frame = rendered()
  await expect(frame.locator('#jump')).toHaveAttribute('href', '#far')
  // The bug this guards: a srcdoc document resolves relative URLs against the
  // page embedding it, so `#far` became an address for the app's own window —
  // a different document, so a navigation, which the policy refuses. Every
  // table of contents in every page did nothing at all.
  await frame.locator('#jump').click()
  await expect
    .poll(() => frame.locator('body').evaluate(() => window.scrollY), { timeout: 5000 })
    .toBeGreaterThan(200)
})

test('resolves a relative picture without a base element', async () => {
  await openFile('page.html')
  await read()
  // The reader writes one `<base>`, pointing at this document, so that a bare
  // fragment stays a fragment. Every reference that loads is made absolute
  // instead, before the frame ever sees it.
  const src = await rendered().locator('#local').getAttribute('src')
  expect(src).toMatch(/^orrery-asset:\/\//)
})
