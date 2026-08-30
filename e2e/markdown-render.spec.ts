import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

/**
 * Constructs whose rendering is geometric — column alignment, wrap columns,
 * concealed markers — and so can only be verified in a real browser.
 */
const DOC = `# Render check

- a top level bullet item that is deliberately long enough to wrap onto a second visual line and keeps going well past the right edge so the wrap is certain at any sane pane width
  - a nested bullet item that is also long enough to wrap onto a second visual line here and keeps going well past the right edge so the wrap is certain at any sane pane width
- [ ] a task whose label is long enough to wrap onto a second visual line and keeps going well past the right edge so the wrap is certain at any sane pane width

1. an ordered item that is long enough to wrap onto a second visual line in this pane and keeps going well past the right edge so the wrap is certain at any sane pane width
10. a tenth ordered item that is long enough to wrap onto a second visual line here and keeps going well past the right edge so the wrap is certain at any sane pane width

\`\`\`ts
const tree = { src: ['main.ts'] } // aligned comment
\`\`\`

\`\`\`
project/
├── src/
│   └── main.ts
└── package.json
\`\`\`

    indented code block
    ├── stays aligned

> a quoted paragraph that lazily
> continues on a second source line

> [!WARNING] Be careful
> body of the callout
`

/**
 * Put one end of the document on screen.
 *
 * CodeMirror renders the viewport rather than the document, so a construct
 * below the fold has no DOM to measure. This fixture is deliberately taller
 * than the window, and which half is on screen depends on the width of
 * everything beside the editor, so no test may assume it.
 */
async function scrollTo(end: 'top' | 'bottom'): Promise<void> {
  await page.locator('.cm-scroller').evaluate((el, where) => {
    el.scrollTop = where === 'top' ? 0 : el.scrollHeight
  }, end)
  await page.waitForTimeout(120)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-render-'))
  writeFileSync(join(vault, 'Render.md'), DOC)
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Render.md')
  await page.locator('.tree-row--file', { hasText: 'Render.md' }).click()
  await page.waitForSelector('.cm-content')
  await scrollTo('bottom')
  await page.waitForSelector('.cm-or-code-line')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('code blocks keep their columns', async () => {
  await scrollTo('bottom')
  // Never wrapped: an ASCII tree or an aligned comment must not reflow.
  const whiteSpace = await page
    .locator('.cm-or-code-line')
    .first()
    .evaluate((el) => getComputedStyle(el).whiteSpace)
  expect(whiteSpace).toBe('pre')

  // One font size for every token, or glyph widths stagger mid-line.
  const sizes = await page
    .locator('.cm-or-code-line')
    .nth(1)
    .evaluate((el) =>
      Array.from(el.querySelectorAll('span')).map((s) => getComputedStyle(s).fontSize)
    )
  expect(new Set(sizes).size).toBe(1)

  // Indented (4-space) code blocks get the same card as fenced ones.
  const indented = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.cm-or-code-line')).some((el) =>
      (el.textContent ?? '').includes('indented code block')
    )
  )
  expect(indented).toBe(true)
})

test('list items hang their wrapped lines under the item text', async () => {
  await scrollTo('top')
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.cm-or-li')).map((el) => {
      // One text node spanning a soft wrap yields one rect per visual line —
      // unlike a Range over the whole line, whose rects are per box (the marker
      // spans each contribute one) and so can't tell a wrap from a span.
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let rects: DOMRect[] = []
      let node: Node | null
      while ((node = walker.nextNode())) {
        const range = document.createRange()
        range.selectNodeContents(node)
        const own = Array.from(range.getClientRects()).filter((r) => r.width > 1)
        if (own.length > rects.length) rects = own
      }
      const style = getComputedStyle(el)
      // Wrapped lines start at the padding edge, which is the item's text
      // column: the first line only sits left of it via a negative text-indent
      // that puts the marker in its own column.
      const column = el.getBoundingClientRect().left + parseFloat(style.paddingLeft)
      return {
        wrapped: rects.length > 1,
        errPx: rects.length > 1 ? Math.abs(rects[rects.length - 1]!.left - column) : 0
      }
    })
  )
  expect(rows.filter((r) => r.wrapped).length).toBeGreaterThan(3)
  for (const row of rows) expect(row.errPx).toBeLessThanOrEqual(3)
})

test('blockquotes and callouts conceal their markers', async () => {
  await scrollTo('bottom')
  const quote = await page.locator('.cm-or-blockquote').first().textContent()
  expect(quote).toBe('a quoted paragraph that lazily continues on a second source line')

  const callout = await page
    .locator('.cm-or-callout--warning')
    .first()
    .evaluate((el) => ({
      text: el.textContent,
      title: el.querySelector('.cm-or-callout-title')?.textContent ?? null,
      // `[!WARNING]` parses as a shortcut link — it must not render as one.
      link: el.querySelector('.cm-or-link-text')?.textContent ?? null
    }))
  expect(callout.title).toBe('Be careful')
  expect(callout.link).toBeNull()
  expect(callout.text).not.toContain('[!')
})

test('code fences hide until the cursor is on the fence line', async () => {
  await scrollTo('bottom')
  // Nothing in the rendered document shows the fence syntax…
  await expect(page.locator('.cm-content')).not.toContainText('```')
  // …but the language badge survives as the card's header.
  await expect(page.locator('.cm-or-code-info').first()).toHaveText('ts')

  // Stepping onto the opening fence line brings the backticks back.
  await page.locator('.cm-or-code-line', { hasText: 'const tree' }).click()
  await page.keyboard.press('ArrowUp')
  await expect(page.locator('.cm-content')).toContainText('```ts')

  // And leaving it hides them again.
  await page.locator('.cm-line', { hasText: 'Render check' }).click()
  await expect(page.locator('.cm-content')).not.toContainText('```')
})
