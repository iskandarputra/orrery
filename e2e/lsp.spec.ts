import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string
let binDir: string
let originalPath: string | undefined
/** What the stub server was asked, one request per line. */
let stubLog: string

const SOURCE = ['const fine = 1', 'const BAD = 2', 'const alsoFine = 3'].join('\n') + '\n'

async function open(file: string): Promise<void> {
  await page.locator('.tree-row--file', { hasText: file }).click()
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 15_000 })
}

/** The messages CodeMirror is currently showing for this document. */
async function diagnostics(): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.cm-lintRange-error, .cm-lintRange-warning')).map(
      (el) => el.textContent ?? ''
    )
  )
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-lsp-'))
  writeFileSync(join(vault, 'Note.md'), '# Note\n\nProse.\n')
  writeFileSync(join(vault, 'code.ts'), SOURCE)
  writeFileSync(join(vault, 'target.ts'), 'export const definedHere = 1\n')

  // A stand-in for typescript-language-server, put on PATH ahead of any real
  // one. The client cannot tell the difference, which is the point: the test
  // exercises spawn, framing, handshake, sync and publish for real, and needs
  // nothing installed on the machine running it.
  binDir = mkdtempSync(join(tmpdir(), 'orrery-lsp-bin-'))
  const stub = resolve('e2e/fixtures/stub-language-server.mjs')
  const shim = join(binDir, 'typescript-language-server')
  writeFileSync(shim, `#!/bin/sh\nexec node ${JSON.stringify(stub)} "$@"\n`)
  chmodSync(shim, 0o755)
  originalPath = process.env['PATH']
  process.env['PATH'] = `${binDir}:${originalPath ?? ''}`
  stubLog = join(binDir, 'requests.log')
  process.env['ORRERY_STUB_LSP_LOG'] = stubLog

  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1300, height: 850 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'code.ts')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  if (originalPath !== undefined) process.env['PATH'] = originalPath
  delete process.env['ORRERY_STUB_LSP_LOG']
  rmSync(vault, { recursive: true, force: true })
  rmSync(binDir, { recursive: true, force: true })
})

/**
 * The whole pipe in one assertion: main spawns the server, frames the
 * handshake, syncs the document, decodes what comes back, routes it to the
 * right buffer, and the editor draws it.
 */
test('a server diagnostic reaches the editor', async () => {
  await open('code.ts')
  await expect
    .poll(async () => (await diagnostics()).length, { timeout: 20_000 })
    .toBeGreaterThan(0)
  // Underlining the offending token, not the whole line.
  expect((await diagnostics())[0]).toBe('BAD')
})

test('editing the document updates what the server says', async () => {
  await open('code.ts')
  await expect.poll(async () => (await diagnostics()).length, { timeout: 20_000 }).toBe(1)

  // Add a second offence; the client re-syncs and the server re-publishes.
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('const BAD2 = 4')

  await expect.poll(async () => (await diagnostics()).length, { timeout: 20_000 }).toBe(2)
})

test('hovering a symbol shows what the server knows about it', async () => {
  await open('code.ts')
  await expect
    .poll(async () => (await diagnostics()).length, { timeout: 20_000 })
    .toBeGreaterThan(0)

  // The server first, asked directly, so a failure further down is about the
  // pointer and not about whether an answer was there to show. This test fails
  // on CI and passes locally, and until it said which half broke, nothing did.
  const direct = await page.evaluate(
    (path) => window.orrery.invoke('lsp:hover', { path, line: 0, character: 6 }),
    join(vault, 'code.ts')
  )
  expect(direct, 'the server answers a hover asked for directly').toContain('stub docs for')

  // Hover the word "fine" on the first line.
  // CodeMirror tracks the pointer across a run of mousemove events and then
  // waits for it to settle; one jump to the target coordinate produces neither.
  const box = (await page.locator('.cm-content .cm-line').first().boundingBox())!
  await page.locator('.cm-content').click()
  const target = { x: box.x + 48, y: box.y + box.height / 2 }
  // And the pointer's target is text on that line, not padding or another line.
  const under = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y)
    const line = el?.closest('.cm-line')
    const first = document.querySelector('.cm-content .cm-line')
    return { onFirstLine: !!line && line === first, text: line?.textContent ?? el?.className ?? '' }
  }, target)
  expect(under, 'the pointer is over the first line').toEqual({
    onFirstLine: true,
    text: 'const fine = 1'
  })
  // What the editor itself receives while the pointer moves, for the failure
  // message: CI's server has been shown to see no hover from the pointer.
  await page.evaluate(() => {
    const events: string[] = []
    ;(window as unknown as { __hoverEvents: string[] }).__hoverEvents = events
    const start = performance.now()
    const note = (e: MouseEvent): void => {
      const t = e.target as Element
      events.push(
        `${Math.round(performance.now() - start)}ms ${e.type} ${e.clientX},${e.clientY} ${t.className || t.tagName}`
      )
    }
    const dom = document.querySelector('.cm-editor')!
    for (const type of ['mousemove', 'mouseleave', 'mouseover', 'mouseout'] as const) {
      dom.addEventListener(type, note as EventListener, true)
    }
  })
  await page.mouse.move(box.x + 10, target.y, { steps: 5 })
  await page.mouse.move(target.x, target.y, { steps: 15 })

  const tip = page.locator('.cm-or-hover')
  // If nothing shows, say whether the pointer ever asked: the direct request
  // above is one hover, so a second means CodeMirror asked and the tooltip is
  // what went missing, and only one means the pointer never reached it.
  const hovers = (): string[] =>
    (existsSync(stubLog) ? readFileSync(stubLog, 'utf-8') : '')
      .split('\n')
      .filter((l) => l.startsWith('textDocument/hover'))
  try {
    await expect(tip).toBeVisible({ timeout: 15_000 })
  } catch (err) {
    // Read after the wait, not before it: a request can land at any point in it.
    const events = await page.evaluate(
      () => (window as unknown as { __hoverEvents?: string[] }).__hoverEvents ?? []
    )
    // CodeMirror measures on animation frames; a page the browser has decided
    // is hidden gets none, and a hover then finds no position to ask about.
    const page_ = await page.evaluate(async () => {
      let frames = 0
      const end = performance.now() + 500
      await new Promise<void>((done) => {
        const tick = (): void => {
          frames++
          if (performance.now() < end) requestAnimationFrame(tick)
          else done()
        }
        requestAnimationFrame(tick)
        setTimeout(done, 1000)
      })
      return {
        visibility: document.visibilityState,
        focused: document.hasFocus(),
        framesIn500ms: frames,
        window: `${innerWidth}x${innerHeight}`,
        screen: `${screen.width}x${screen.height}`
      }
    })
    throw new Error(
      `${(err as Error).message}\nhover requests the server saw: ${JSON.stringify(hovers())}` +
        `\neditor mouse events (last 12 of ${events.length}): ${JSON.stringify(events.slice(-12))}` +
        `\npage: ${JSON.stringify(page_)}`,
      { cause: err }
    )
  }
  await expect(tip).toContainText('stub docs for')
})

test('go to definition jumps to the other file', async () => {
  await open('code.ts')
  await expect
    .poll(async () => (await diagnostics()).length, { timeout: 20_000 })
    .toBeGreaterThan(0)

  await page.locator('.cm-content').click()
  await page.keyboard.press('F12')

  // The definition lives in another file, so the jump has to open it first.
  await expect(page.locator('.tab--active')).toContainText('target.ts', { timeout: 15_000 })
  await expect
    .poll(() => page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? ''), {
      timeout: 15_000
    })
    .toContain('definedHere')
})

test('completion offers what the server suggests', async () => {
  await open('code.ts')
  await expect
    .poll(async () => (await diagnostics()).length, { timeout: 20_000 })
    .toBeGreaterThan(0)

  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('\nstub')
  // Ask explicitly rather than waiting on the type-to-trigger debounce, which
  // under a loaded suite can settle after the assertion starts. The request,
  // the response and the rendering are the same either way.
  await page.keyboard.press('Control+Space')

  const list = page.locator('.cm-tooltip-autocomplete')
  await expect(list).toBeVisible({ timeout: 15_000 })
  await expect(list).toContainText('stubComplete')
  // The detail the server sent comes through too, not just the label.
  await expect(list).toContainText('(a: number) => void')

  // Wait for an option to be *selected*, not merely for the list to exist:
  // Enter accepts the selection, and the tooltip is in the DOM a moment before
  // the selection is committed.
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            document.querySelectorAll('.cm-tooltip-autocomplete li[aria-selected="true"]').length
        ),
      { timeout: 10_000 }
    )
    .toBe(1)

  // Accepted by clicking the selected option. A synthetic Enter arrives faster
  // than any keystroke and lands before the completion has settled, which is a
  // property of the harness rather than of the feature; clicking exercises the
  // same acceptance path deterministically.
  await page.locator('.cm-tooltip-autocomplete li[aria-selected="true"]').click()
  await expect
    .poll(() => page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? ''), {
      timeout: 10_000
    })
    .toContain('stubComplete')
})

test('a note never reaches a language server', async () => {
  await open('Note.md')
  // Prose has no server and no lint surface at all.
  await expect(page.locator('.cm-lintRange-error')).toHaveCount(0)
  await expect(page.locator('.cm-gutter-lint')).toHaveCount(0)
})
