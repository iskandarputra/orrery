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

/** One note exercising every construct the editor claims to render. */
const TORTURE = `---
title: Torture test
tags: [alpha, beta]
---

# H1 heading
## H2 heading
### H3 heading
#### H4 heading
##### H5 heading
###### H6 heading

Prose with **bold**, *italic*, ~~strike~~, ==highlight==, \`inline code\`, a #tag,
a [link](https://example.com), a [[Wikilink]], a [[Missing Note]], and an ![img](nope.png).

- bullet one
- bullet two
  - nested
- [ ] task open
- [x] task done

1. ordered one
2. ordered two
9. ordered nine
10. ordered ten
11. ordered eleven

> quote line
> second line

> [!NOTE] a note callout
> body of the note

> [!WARNING] a warning callout
> body of the warning

> [!TIP] a tip callout
> body of the tip

\`\`\`ts
const code = 'fenced'
\`\`\`

    indented code

| left | mid | right |
| :--- | :-: | ----: |
| a    | b   | c     |

$$
E = mc^2
$$

Inline math $a^2+b^2$ here.

---

<!-- an html comment -->

Line with two trailing spaces  
and a hard break above.
`

async function runCommand(commandId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

/** CodeMirror renders only the viewport, so walk the document as we collect. */
async function classesThroughDocument(): Promise<Set<string>> {
  const all = new Set<string>()
  for (let step = 0; step <= 10; step++) {
    const seen = await page.evaluate(() => {
      const found: string[] = []
      document.querySelectorAll('[class*="cm-zy-"]').forEach((el) => {
        el.className
          .split(/\s+/)
          .filter((c) => c.startsWith('cm-zy-'))
          .forEach((c) => found.push(c))
      })
      return found
    })
    seen.forEach((c) => all.add(c))
    await page
      .locator('.cm-scroller')
      .evaluate((el, s) => el.scrollTo(0, (el.scrollHeight * s) / 10), step)
    await page.waitForTimeout(200)
  }
  await page.locator('.cm-scroller').evaluate((el) => el.scrollTo(0, 0))
  return all
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'zymd-audit-'))
  writeFileSync(join(vault, 'Torture.md'), TORTURE)
  app = await electron.launch({
    args: ['./out/main/index.js', '--no-sandbox'],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Torture.md')
  await page.locator('.tree-row--file', { hasText: 'Torture.md' }).click()
  await runCommand('view.modeReading')
  await page.waitForSelector('.cm-zy-h1')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('every construct renders its decoration', async () => {
  const present = await classesThroughDocument()
  const expected = [
    'cm-zy-h1', 'cm-zy-h2', 'cm-zy-h3', 'cm-zy-h4', 'cm-zy-h5', 'cm-zy-h6',
    'cm-zy-inline-code', 'cm-zy-mark', 'cm-zy-tag', 'cm-zy-link-text',
    'cm-zy-wikilink', 'cm-zy-wikilink--missing', 'cm-zy-image', 'cm-zy-image--broken',
    'cm-zy-bullet', 'cm-zy-task-checkbox', 'cm-zy-li', 'cm-zy-li--first',
    'cm-zy-blockquote', 'cm-zy-blockquote--first',
    'cm-zy-callout', 'cm-zy-callout--note', 'cm-zy-callout--warning', 'cm-zy-callout--tip',
    'cm-zy-callout-title',
    'cm-zy-code-line', 'cm-zy-code-first', 'cm-zy-code-last', 'cm-zy-code-info',
    'cm-zy-table', 'cm-zy-math', 'cm-zy-math--block', 'cm-zy-hr',
    'cm-zy-properties-card', 'cm-zy-property-key', 'cm-zy-property-val'
  ]
  const missing = expected.filter((c) => !present.has(c))
  expect(missing).toEqual([])
})

test('heading rhythm actually applies', async () => {
  // The editor theme styles `.cm-line` with higher specificity than a plain
  // `.cm-zy-*` rule, which has silently killed line-level padding before.
  const padding = await page.evaluate(() =>
    [1, 2, 3, 4, 5, 6].map((n) => {
      const el = document.querySelector(`.cm-zy-h${n}`) as HTMLElement | null
      return el ? parseFloat(getComputedStyle(el).paddingTop) : -1
    })
  )
  for (const value of padding) expect(value).toBeGreaterThan(0)
  // And the scale is descending: an H1 breathes more than an H6.
  expect(padding[0]!).toBeGreaterThan(padding[5]!)
})

test('block containers all start at the text column', async () => {
  // CodeMirror only builds the viewport, so each block has to be brought into
  // view before it can be measured — otherwise this asserts against nothing.
  const leftOf = async (selector: string): Promise<number> => {
    const locator = page.locator(selector).first()
    await locator.scrollIntoViewIfNeeded()
    await page.waitForTimeout(120)
    return Math.round((await locator.boundingBox())!.x)
  }

  await page.locator('.cm-scroller').evaluate((el) => el.scrollTo(0, 0))
  await page.waitForTimeout(150)
  const column = Math.round(
    (await page.locator('.cm-zy-h1 span').first().boundingBox())!.x
  )

  // A card starting further left than the prose reads as misaligned.
  for (const selector of [
    '.cm-zy-properties-card',
    '.cm-zy-code-line',
    '.cm-zy-blockquote',
    '.cm-zy-math--block'
  ]) {
    expect(await leftOf(selector), selector).toBe(column)
  }
})

test('every list marker shares one grid', async () => {
  await page.locator('.cm-zy-li').first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(150)

  const rows = await page.evaluate(() => {
    const lineLeft = document.querySelector('.cm-line')!.getBoundingClientRect().left
    return Array.from(document.querySelectorAll('.cm-zy-li')).map((el) => {
      const marker =
        el.querySelector('.cm-zy-bullet') ??
        el.querySelector('.cm-zy-ordered-mark') ??
        el.querySelector('.cm-zy-task-box')
      // Measured on the text node itself: a nested item wraps its text in no
      // element, so lastElementChild would hand back the marker instead.
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let textX: number | null = null
      let node: Node | null
      while ((node = walker.nextNode())) {
        const value = node.textContent ?? ''
        if (!value.trim() || marker?.contains(node)) continue
        const range = document.createRange()
        const offset = value.search(/\S/)
        range.setStart(node, offset)
        range.setEnd(node, offset + 1)
        textX = Math.round(range.getBoundingClientRect().left - lineLeft)
        break
      }
      return {
        depth: Number(getComputedStyle(el).getPropertyValue('--zy-li-depth') || 0),
        markerX: marker ? Math.round(marker.getBoundingClientRect().left - lineLeft) : null,
        textX
      }
    })
  })

  expect(rows.length).toBeGreaterThan(6)
  expect(rows.every((r) => r.markerX !== null && r.textX !== null)).toBe(true)

  // Bullets, `1.`, `10.` and checkboxes are different markers of different
  // widths; the marker column is what makes them share one text edge.
  const byDepth = new Map<number, typeof rows>()
  for (const row of rows) byDepth.set(row.depth, [...(byDepth.get(row.depth) ?? []), row])
  for (const [depth, group] of byDepth) {
    expect(new Set(group.map((r) => r.markerX)).size, `markers at depth ${depth}`).toBe(1)
    expect(new Set(group.map((r) => r.textX)).size, `text edges at depth ${depth}`).toBe(1)
  }

  // Each level steps by a constant amount, and the gap between a marker and its
  // text never collapses — styling a nested glyph must not shrink the column.
  const depths = [...byDepth.keys()].sort((a, b) => a - b)
  const gaps = depths.map((d) => byDepth.get(d)![0]!.textX! - byDepth.get(d)![0]!.markerX!)
  expect(new Set(gaps).size, 'marker-to-text gap per depth').toBe(1)
  expect(gaps[0]).toBeGreaterThan(12)

  const steps = depths.slice(1).map((d, i) =>
    byDepth.get(d)![0]!.markerX! - byDepth.get(depths[i]!)![0]!.markerX!
  )
  expect(new Set(steps).size, 'indent step per level').toBe(1)
  expect(steps[0]).toBeGreaterThan(12)
})

test('callout types are told apart by colour', async () => {
  const bars = await page.evaluate(() =>
    ['note', 'warning', 'tip'].map((type) => {
      const el = document.querySelector(`.cm-zy-callout--${type}`) as HTMLElement | null
      return el ? getComputedStyle(el).borderLeftColor : null
    })
  )
  expect(new Set(bars).size).toBe(3)
})

test('table alignment follows the delimiter row', async () => {
  await page.locator('.cm-zy-table').first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(150)
  const cells = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.cm-zy-table th')).map(
      (el) => getComputedStyle(el).textAlign
    )
  )
  expect(cells).toEqual(['left', 'center', 'right'])
})

test('html comments hide when reading and return when editing', async () => {
  const reading = await classesThroughDocument()
  expect(reading.has('cm-zy-comment-line')).toBe(false)

  await runCommand('view.modeHybrid')
  await page.waitForTimeout(400)
  const hybrid = await classesThroughDocument()
  expect(hybrid.has('cm-zy-comment-line')).toBe(true)
  await runCommand('view.modeReading')
})

test('an empty histogram bucket draws no bar', async () => {
  // A minimum bar height would make "no notes" look like a small value.
  await runCommand('view.toggleAnalytics')
  await page.waitForSelector('.analytics__hist')
  const heights = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.analytics__hist-col')).map((col) => ({
      label: col.querySelector('.analytics__hist-value')?.textContent ?? '',
      barHeight: Math.round(
        (col.querySelector('.analytics__hist-bar') as HTMLElement).getBoundingClientRect().height
      )
    }))
  )
  for (const bucket of heights) {
    if (bucket.label === '') expect(bucket.barHeight).toBe(0)
  }
  expect(heights.some((b) => b.barHeight > 0)).toBe(true)
  await page.keyboard.press('Escape')
})
