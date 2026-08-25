import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { closeCleanly, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

/**
 * Constructs whose rendering is geometric — column alignment, wrap columns,
 * concealed markers — and so can only be verified in a real browser.
 */
const DOC = `# Render check

- a top level bullet item that is deliberately long enough to wrap onto a second visual line
  - a nested bullet item that is also long enough to wrap onto a second visual line here
- [ ] a task

1. an ordered item that is long enough to wrap onto a second visual line in this pane
10. a tenth ordered item that is long enough to wrap onto a second visual line here

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

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'zymd-render-'))
  writeFileSync(join(vault, 'Render.md'), DOC)
  app = await electron.launch({
    args: ['./out/main/index.js', '--no-sandbox'],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Render.md')
  await page.locator('.tree-row--file', { hasText: 'Render.md' }).click()
  await page.waitForSelector('.cm-zy-code-line')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('code blocks keep their columns', async () => {
  // Never wrapped: an ASCII tree or an aligned comment must not reflow.
  const whiteSpace = await page
    .locator('.cm-zy-code-line')
    .first()
    .evaluate((el) => getComputedStyle(el).whiteSpace)
  expect(whiteSpace).toBe('pre')

  // One font size for every token, or glyph widths stagger mid-line.
  const sizes = await page
    .locator('.cm-zy-code-line')
    .nth(1)
    .evaluate((el) =>
      Array.from(el.querySelectorAll('span')).map((s) => getComputedStyle(s).fontSize)
    )
    expect(new Set(sizes).size).toBe(1)

  // Indented (4-space) code blocks get the same card as fenced ones.
  const indented = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.cm-zy-code-line')).some((el) =>
      (el.textContent ?? '').includes('indented code block')
    )
  )
  expect(indented).toBe(true)
})

test('list items hang their wrapped lines under the item text', async () => {
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.cm-zy-li')).map((el) => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const rects = Array.from(range.getClientRects()).filter((r) => r.width > 1)
      const content = el.lastElementChild
      return {
        wrapped: rects.length > 1,
        // The last element child holds the item text; the wrapped line should
        // start at the same column, not back at the left margin.
        errPx:
          rects.length > 1 && content
            ? Math.abs(rects[rects.length - 1]!.left - content.getBoundingClientRect().left)
            : 0
      }
    })
  )
  expect(rows.filter((r) => r.wrapped).length).toBeGreaterThan(3)
  for (const row of rows) expect(row.errPx).toBeLessThanOrEqual(3)
})

test('blockquotes and callouts conceal their markers', async () => {
  const quote = await page.locator('.cm-zy-blockquote').first().textContent()
  expect(quote).toBe('a quoted paragraph that lazily continues on a second source line')

  const callout = await page.locator('.cm-zy-callout--warning').first().evaluate((el) => ({
    text: el.textContent,
    title: el.querySelector('.cm-zy-callout-title')?.textContent ?? null,
    // `[!WARNING]` parses as a shortcut link — it must not render as one.
    link: el.querySelector('.cm-zy-link-text')?.textContent ?? null
  }))
  expect(callout.title).toBe('Be careful')
  expect(callout.link).toBeNull()
  expect(callout.text).not.toContain('[!')
})

test('code fences hide until the cursor is on the fence line', async () => {
  // Nothing in the rendered document shows the fence syntax…
  await expect(page.locator('.cm-content')).not.toContainText('```')
  // …but the language badge survives as the card's header.
  await expect(page.locator('.cm-zy-code-info').first()).toHaveText('ts')

  // Stepping onto the opening fence line brings the backticks back.
  await page.locator('.cm-zy-code-line', { hasText: 'const tree' }).click()
  await page.keyboard.press('ArrowUp')
  await expect(page.locator('.cm-content')).toContainText('```ts')

  // And leaving it hides them again.
  await page.locator('.cm-line', { hasText: 'Render check' }).click()
  await expect(page.locator('.cm-content')).not.toContainText('```')
})
