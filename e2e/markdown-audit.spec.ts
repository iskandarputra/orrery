import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

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
      document.querySelectorAll('[class*="cm-or-"]').forEach((el) => {
        el.className
          .split(/\s+/)
          .filter((c) => c.startsWith('cm-or-'))
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
  vault = mkdtempSync(join(tmpdir(), 'orrery-audit-'))
  writeFileSync(join(vault, 'Torture.md'), TORTURE)
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Torture.md')
  await page.locator('.tree-row--file', { hasText: 'Torture.md' }).click()
  await runCommand('view.modeReading')
  await page.waitForSelector('.cm-or-h1')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('every construct renders its decoration', async () => {
  const present = await classesThroughDocument()
  const expected = [
    'cm-or-h1',
    'cm-or-h2',
    'cm-or-h3',
    'cm-or-h4',
    'cm-or-h5',
    'cm-or-h6',
    'cm-or-inline-code',
    'cm-or-mark',
    'cm-or-tag',
    'cm-or-link-text',
    'cm-or-wikilink',
    'cm-or-wikilink--missing',
    'cm-or-image',
    'cm-or-image--broken',
    'cm-or-bullet',
    'cm-or-task-checkbox',
    'cm-or-li',
    'cm-or-li--first',
    'cm-or-blockquote',
    'cm-or-blockquote--first',
    'cm-or-callout',
    'cm-or-callout--note',
    'cm-or-callout--warning',
    'cm-or-callout--tip',
    'cm-or-callout-title',
    'cm-or-code-card',
    'cm-or-code-card__lang',
    'cm-or-code-card__pre',
    'cm-or-table',
    'cm-or-math',
    'cm-or-math--block',
    'cm-or-hr',
    'cm-or-properties-card',
    'cm-or-property-key',
    'cm-or-property-val'
  ]
  const missing = expected.filter((c) => !present.has(c))
  expect(missing).toEqual([])

  // Reading mode replaces a fence with one scrollable card, so the per-line
  // code rendering it used to show now belongs to the editing modes. Checked
  // here rather than dropped, or the swap above would quietly lose it.
  await runCommand('view.modeHybrid')
  await page.waitForTimeout(400)
  const editing = await classesThroughDocument()
  const editingMissing = [
    'cm-or-code-line',
    'cm-or-code-first',
    'cm-or-code-last',
    'cm-or-code-info'
  ].filter((c) => !editing.has(c))
  expect(editingMissing).toEqual([])
  await runCommand('view.modeReading')
})

test('heading rhythm actually applies', async () => {
  // The editor theme styles `.cm-line` with higher specificity than a plain
  // `.cm-or-*` rule, which has silently killed line-level padding before.
  const padding = await page.evaluate(() =>
    [1, 2, 3, 4, 5, 6].map((n) => {
      const el = document.querySelector(`.cm-or-h${n}`) as HTMLElement | null
      return el ? parseFloat(getComputedStyle(el).paddingTop) : -1
    })
  )
  for (const value of padding) expect(value).toBeGreaterThan(0)
  // And the scale is descending: an H1 breathes more than an H6.
  expect(padding[0]!).toBeGreaterThan(padding[5]!)
})

/**
 * Bring a block into view, scrolling until it exists.
 *
 * CodeMirror renders only the viewport, so a block below the fold is absent
 * from the DOM entirely — waiting on its selector would wait forever, and any
 * measurement of it is a measurement of nothing.
 */
async function showBlock(selector: string): Promise<void> {
  const scroller = page.locator('.cm-scroller')
  for (let step = 0; step < 40; step++) {
    if (await page.locator(selector).count()) {
      await page.locator(selector).first().scrollIntoViewIfNeeded()
      await page.waitForTimeout(120)
      return
    }
    await scroller.evaluate((el) => el.scrollBy(0, el.clientHeight * 0.75))
    await page.waitForTimeout(90)
  }
  throw new Error(`never rendered: ${selector}`)
}

test('block containers all start at the text column', async () => {
  // Each block has to be brought into view before it can be measured.
  const leftOf = async (selector: string): Promise<number> => {
    await showBlock(selector)
    return Math.round((await page.locator(selector).first().boundingBox())!.x)
  }

  await page.locator('.cm-scroller').evaluate((el) => el.scrollTo(0, 0))
  await page.waitForTimeout(150)
  const column = Math.round((await page.locator('.cm-or-h1 span').first().boundingBox())!.x)

  // A card starting further left than the prose reads as misaligned.
  for (const selector of [
    '.cm-or-properties-card',
    '.cm-or-code-line',
    '.cm-or-blockquote',
    '.cm-or-math--block'
  ]) {
    expect(await leftOf(selector), selector).toBe(column)
  }
})

test('every list marker shares one grid', async () => {
  await showBlock('.cm-or-li')

  const rows = await page.evaluate(() => {
    const lineLeft = document.querySelector('.cm-line')!.getBoundingClientRect().left
    return Array.from(document.querySelectorAll('.cm-or-li')).map((el) => {
      const marker =
        el.querySelector('.cm-or-bullet') ??
        el.querySelector('.cm-or-ordered-mark') ??
        el.querySelector('.cm-or-task-box')
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
        depth: Number(getComputedStyle(el).getPropertyValue('--or-li-depth') || 0),
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

  const steps = depths
    .slice(1)
    .map((d, i) => byDepth.get(d)![0]!.markerX! - byDepth.get(depths[i]!)![0]!.markerX!)
  expect(new Set(steps).size, 'indent step per level').toBe(1)
  expect(steps[0]).toBeGreaterThan(12)
})

test('callout types are told apart by colour', async () => {
  await showBlock('.cm-or-callout--tip')
  const bars = await page.evaluate(() =>
    ['note', 'warning', 'tip'].map((type) => {
      const el = document.querySelector(`.cm-or-callout--${type}`) as HTMLElement | null
      return el ? getComputedStyle(el).borderLeftColor : null
    })
  )
  expect(new Set(bars).size).toBe(3)
})

test('a callout title takes its own line, above the body', async () => {
  await showBlock('.cm-or-callout--note')

  // `> [!NOTE] Title` and the body under it are one paragraph to the parser, so
  // paragraph reflow would join them onto a single line unless it makes an
  // exception for the title.
  const box = await page.evaluate(() => {
    const lines = Array.from(document.querySelectorAll('.cm-or-callout--note'))
    const title = lines[0]!.querySelector('.cm-or-callout-title')
    if (!title) return null
    const body = lines[1]
    if (!body) return null
    const firstChar = (el: Element): DOMRect | null => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      let node: Node | null
      while ((node = walker.nextNode())) {
        const value = node.textContent ?? ''
        const offset = value.search(/\S/)
        if (offset < 0) continue
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + 1)
        return range.getBoundingClientRect()
      }
      return null
    }
    const t = firstChar(title)!
    const b = firstChar(body)!
    return { titleBottom: t.bottom, titleLeft: t.left, bodyTop: b.top, bodyLeft: b.left }
  })

  expect(box, 'callout title and a body line').not.toBeNull()
  expect(box!.bodyTop).toBeGreaterThanOrEqual(box!.titleBottom - 2)
  expect(Math.abs(box!.bodyLeft - box!.titleLeft)).toBeLessThanOrEqual(1)
})

test('a concealed code fence collapses but keeps the card padded', async () => {
  // Hybrid rather than Reading: Reading renders a fence as a single card, which
  // has no fence lines left to collapse. This is about the editing rendering.
  await runCommand('view.modeHybrid')
  await page.waitForTimeout(400)
  await showBlock('.cm-or-code-line')
  const lines = page.locator('.cm-or-code-line')

  const heights = await lines.evaluateAll((els) =>
    els.map((el) => ({
      hidden: el.classList.contains('cm-or-code-fence-hidden'),
      h: el.getBoundingClientRect().height
    }))
  )
  const code = heights.find((l) => !l.hidden)!
  const hidden = heights.filter((l) => l.hidden)
  expect(hidden.length).toBeGreaterThan(0)
  for (const line of hidden) {
    // Collapsed — an empty text line inside the card reads as a rendering bug.
    expect(line.h).toBeLessThan(code.h * 0.6)
    // ...but not to nothing: the card would lose its edge padding.
    expect(line.h).toBeGreaterThan(4)
  }
  await runCommand('view.modeReading')
})

test('table alignment follows the delimiter row', async () => {
  await showBlock('.cm-or-table')
  const cells = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.cm-or-table th')).map(
      (el) => getComputedStyle(el).textAlign
    )
  )
  expect(cells).toEqual(['left', 'center', 'right'])
})

test('html comments hide when reading and return when editing', async () => {
  const reading = await classesThroughDocument()
  expect(reading.has('cm-or-comment-line')).toBe(false)

  await runCommand('view.modeHybrid')
  await page.waitForTimeout(400)
  const hybrid = await classesThroughDocument()
  expect(hybrid.has('cm-or-comment-line')).toBe(true)
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
