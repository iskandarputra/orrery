import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
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
    <script src="https://cdn.invalid/remote-code.js"></script>
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

/**
 * A page that reaches for things it is not allowed to have.
 *
 * Every reference here is one an untrusted document can simply write, and the
 * frame's scheme reaches exactly one folder — so each of these must come back
 * with nothing. The picture beside it is the control: if that one is blank too,
 * the test is passing for the wrong reason.
 */
const NOSY = `<!doctype html>
<html><head><meta charset="utf-8"><title>Nosy</title></head><body>
<h1>Nosy</h1>
<img id="allowed" src="logo.png" alt="beside the file">
<img id="absolute" src="orrery-page://asset/x/etc/passwd" alt="absolute">
<img id="climb" src="CLIMB_REL" alt="climbing out to a file that really is there">
<img id="asset" src="orrery-asset://local/OUTSIDE_PNG" alt="the app's own scheme">
<script>document.body.setAttribute('data-ran', 'yes')</script>
</body></html>
`

/** Tall enough to scroll, with one remote picture so the offer appears. */
const LONG = `<!doctype html>
<html><head><meta charset="utf-8"><title>Long</title></head><body>
<h1>Long</h1>
<img id="remote" src="https://example.invalid/tracker.png" alt="remote">
<div style="height:3000px">a great deal of page</div>
<p id="foot">the end</p>
</body></html>
`

let app: ElectronApplication
let page: Page
let vault: string
/** A directory that is deliberately not the vault, holding a real picture. */
let outside: string

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

/**
 * Turn the page's scripts on, if they are not on already.
 *
 * Consent is remembered for the buffer, so a test that runs after one which
 * gave it finds the offer already taken and no button to press.
 */
const runScripts = async (): Promise<void> => {
  const offer = page.locator('.htmlv__action', { hasText: 'Run scripts' })
  if (await offer.isVisible()) await offer.click()
  await expect(page.locator('.htmlv__note', { hasText: 'Scripts are running' })).toBeVisible({
    timeout: 20_000
  })
}

const edit = async (): Promise<void> => {
  await page.locator('.header-viewmode__btn', { hasText: 'Edit' }).click()
  await expect(page.locator('.htmlv')).toHaveCount(0)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-html-'))
  outside = mkdtempSync(join(tmpdir(), 'orrery-outside-'))
  writeFileSync(join(outside, 'secret.png'), PNG)
  writeFileSync(join(vault, 'page.html'), PAGE)
  writeFileSync(join(vault, 'site.css'), STYLESHEET)
  writeFileSync(join(vault, 'logo.png'), PNG)
  writeFileSync(join(vault, 'plain.htm'), '<h1>A second page</h1>')
  // A file of its own for the default, so that measuring it neither depends on
  // nor disturbs what any other test left behind.
  writeFileSync(
    join(vault, 'untouched.html'),
    '<h1>Untouched</h1><p id="ran">scripts did not run</p>' +
      "<script>document.getElementById('ran').textContent = 'SCRIPTS RAN'</script>"
  )
  writeFileSync(join(vault, 'rich.html'), RICH)
  writeFileSync(join(vault, 'long.html'), LONG)
  // Both point at `secret.png`, which genuinely exists — one by climbing out
  // of the vault, one over the app's own asset scheme. A test where the file
  // was simply missing would pass for the wrong reason.
  writeFileSync(
    join(vault, 'nosy.html'),
    NOSY.replace('OUTSIDE_PNG', join(outside, 'secret.png').replace(/^\//, '')).replace(
      'CLIMB_REL',
      `../${basename(outside)}/secret.png`
    )
  )
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
  rmSync(outside, { recursive: true, force: true })
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

test('does not run the page’s scripts until asked', async () => {
  await openFile('untouched.html')
  await read('Untouched')
  await expect(rendered().locator('#ran')).toHaveText('scripts did not run')
  await expect(rendered().locator('body')).not.toHaveAttribute('data-script-ran', 'yes')
  // Offered, not done: a page runs nothing until somebody says so for it.
  await expect(page.locator('.htmlv__action', { hasText: 'Run scripts' })).toBeVisible()
})

test('runs them when asked, and says it is doing so', async () => {
  await openFile('page.html')
  await read()
  await runScripts()
  await expect(rendered().locator('#ran')).toHaveText('SCRIPTS RAN', { timeout: 20_000 })
})

test('never offers to fetch code, only content', async () => {
  await openFile('page.html')
  await read()
  // The page carries a remote script and a remote image. Only the image is
  // something the offer can act on, so only the image is counted.
  await expect(page.locator('.htmlv__action', { hasText: 'Load 1 remote item' })).toBeVisible()
})

test('a running page still cannot reach the app around it', async () => {
  // The whole of what makes running somebody else's code acceptable. The frame
  // gets `allow-scripts` and never `allow-same-origin`, so the page sits in an
  // opaque origin: it can draw itself and it can reach nothing else.
  await openFile('page.html')
  await read()
  await runScripts()
  await expect(rendered().locator('#ran')).toHaveText('SCRIPTS RAN', { timeout: 20_000 })

  const reach = await rendered()
    .locator('body')
    .evaluate(() => {
      const attempt = (fn: () => unknown): string => {
        try {
          return 'REACHED:' + String(fn())
        } catch (e) {
          return 'BLOCKED:' + (e as Error).name
        }
      }
      return {
        origin: String(window.origin),
        parent: attempt(() => window.parent.document.title),
        top: attempt(() => window.top!.location.href),
        storage: attempt(() => window.localStorage.length),
        cookie: attempt(() => document.cookie),
        bridge: typeof (window as unknown as { orrery?: unknown }).orrery,
        require: typeof (window as unknown as { require?: unknown }).require
      }
    })

  expect(reach.origin).toBe('null')
  expect(reach.parent).toMatch(/^BLOCKED:/)
  expect(reach.top).toMatch(/^BLOCKED:/)
  expect(reach.storage).toMatch(/^BLOCKED:/)
  expect(reach.cookie).toMatch(/^BLOCKED:/)
  // Nothing of the application's own is in there to be found.
  expect(reach.bridge).toBe('undefined')
  expect(reach.require).toBe('undefined')
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

  // Drawn in place and stamped, which is mermaid's own contract. A real
  // document styles `pre.mermaid svg{max-width:100%}` and
  // `pre.mermaid[data-processed="true"]{white-space:normal}`, and gets neither
  // if the element it wrote is swapped for a different one.
  const block = rendered().locator('pre.mermaid')
  await expect(block).toHaveAttribute('data-processed', 'true')
  await expect(block.locator('svg')).toBeVisible()
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
  // There is no `<base>`: every reference that loads is rewritten before the
  // frame ever sees it, and the address it gets names the preview rather than
  // a path on the disk.
  const src = await rendered().locator('#local').getAttribute('src')
  expect(src).toMatch(/^orrery-page:\/\/asset\//)
  expect(src).not.toContain(vault)
})

test('reaches its own folder and nothing else on the disk', async () => {
  // Each of these is a line an untrusted page can write for itself. The frame's
  // scheme resolves a path against the one folder this page is allowed, in main,
  // so none of them is a file — and `orrery-asset:`, which would have served any
  // of them, is not in the frame's policy at all any more.
  await openFile('nosy.html')
  await read('Nosy')
  const widthOf = async (id: string): Promise<number> =>
    rendered()
      .locator(`#${id}`)
      .evaluate((img) => (img as HTMLImageElement).naturalWidth)

  // The control: a picture beside the file still loads, or the rest proves
  // nothing at all.
  expect(await widthOf('allowed')).toBe(48)

  expect(await widthOf('absolute')).toBe(0)
  expect(await widthOf('climb')).toBe(0)
  expect(await widthOf('asset')).toBe(0)
})

test('cannot walk out even knowing which preview it is', async () => {
  // The page above wrote its addresses blind. This one has been allowed to run,
  // so it can read its own URL, work out the id main knows it by, and build the
  // scheme's own addresses correctly — which is the strongest position an
  // untrusted document is ever in here.
  await openFile('nosy.html')
  await read('Nosy')
  await runScripts()

  const secret = join(outside, 'secret.png')
  const loaded = await rendered()
    .locator('body')
    .evaluate(
      async (_body, paths: string[]) => {
        const id = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() ?? '')
        const tryLoad = (src: string): Promise<boolean> =>
          new Promise((resolve) => {
            const img = new Image()
            img.onload = () => resolve(img.naturalWidth > 0)
            img.onerror = () => resolve(false)
            img.src = src
            setTimeout(() => resolve(false), 3000)
          })

        const [absolute, dots, encoded, control] = await Promise.all([
          tryLoad(`orrery-page://asset/${id}/${paths[0]}`),
          tryLoad(`orrery-page://asset/${id}/../../../../..${paths[1]}`),
          tryLoad(`orrery-page://asset/${id}/%2e%2e/%2e%2e/%2e%2e/%2e%2e${paths[1]}`),
          tryLoad(`orrery-page://asset/${id}/logo.png`)
        ])
        return { id, absolute, dots, encoded, control }
      },
      [secret.replace(/^\//, ''), secret]
    )

  // It found its id, so it was asking the right questions.
  expect(loaded.id).not.toBe('')
  // And the control loaded, so a refusal below is a refusal and not a scheme
  // that stopped working.
  expect(loaded.control).toBe(true)

  expect(loaded.absolute).toBe(false)
  expect(loaded.dots).toBe(false)
  expect(loaded.encoded).toBe(false)
})

test('keeps your place when the page is rebuilt', async () => {
  // The reason the app puts a script of its own into the frame. A rebuild used
  // to be a navigation, which puts a document back at the top — so scrolling
  // down, noticing a picture that did not load and asking for it threw you back
  // to the start, which is the worst possible moment for it.
  await openFile('long.html')
  await read('Long')
  const frame = rendered()

  await frame.locator('body').evaluate(() => window.scrollTo(0, 900))
  await expect.poll(() => frame.locator('body').evaluate(() => window.scrollY)).toBeGreaterThan(800)

  await page.locator('.htmlv__action', { hasText: /Load 1 remote/ }).click()
  await expect(page.locator('.htmlv__note', { hasText: 'Remote content loaded' })).toBeVisible({
    timeout: 15_000
  })
  await page.waitForTimeout(600)

  // The page was rebuilt — and the reader did not move.
  await expect(frame.locator('#foot')).toHaveText('the end')
  // 0 without the patch path, 900 with it.
  expect(await frame.locator('body').evaluate(() => window.scrollY)).toBeGreaterThan(800)
})

test('the page still runs nothing of its own, with the reader in there', async () => {
  // The frame carries `allow-scripts` unconditionally now, so this is the only
  // thing standing between an untrusted document and its own code: a policy
  // naming one file. It is worth checking against a page that tries.
  await openFile('untouched.html')
  await read('Untouched')
  await expect(rendered().locator('#ran')).toHaveText('scripts did not run')
  await page.waitForTimeout(600)
  await expect(rendered().locator('#ran')).toHaveText('scripts did not run')
})

test('offers a way out to a real browser, for a page and nothing else', async () => {
  // The reader withholds most of what a browser does on purpose, so the honest
  // answer to "why does this not look right" needs somewhere to go.
  await openFile('page.html')
  await read()
  const out = page.locator('.htmlv__action', { hasText: 'Browser' })
  await expect(out).toBeVisible()
  await expect(out).toHaveAttribute('title', /none of the reader/)

  // Not clicked: it would launch a browser. What is worth checking is the
  // guard behind it, because this handler *opens* a file — the system runs
  // whatever it associates with the extension — where the one beside it only
  // reveals one. A caller asking for anything but a page is refused in main.
  const refused = await page.evaluate(
    async (paths: string[]) =>
      Promise.all(paths.map((path) => window.orrery.invoke('shell:openInBrowser', { path }))),
    [join(vault, 'Note.md'), join(vault, 'logo.png'), '/bin/sh', join(vault, 'nothing.sh')]
  )
  expect(refused).toEqual([false, false, false, false])
})

test('says so when the file on disk is not what you are looking at', async () => {
  // It opens what is saved; the reader shows the buffer. When those have come
  // apart the button has to admit it rather than quietly showing an old page.
  await openFile('page.html')
  await edit()
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('<p>unsaved</p>')
  await read()

  await expect(page.locator('.htmlv__action', { hasText: 'Browser' })).toHaveAttribute(
    'title',
    /unsaved changes, which the browser will not show/
  )

  await runCommand('file.save')
  await page.waitForTimeout(400)
  await expect(page.locator('.htmlv__action', { hasText: 'Browser' })).toHaveAttribute(
    'title',
    /none of the reader/
  )
})
