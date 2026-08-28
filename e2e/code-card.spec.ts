import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

/** Far wider than any pane the app will be given. */
const LONG = "const x = '" + 'a'.repeat(200) + "' // trailing comment"

async function setViewMode(mode: 'live' | 'reading'): Promise<void> {
  await page.evaluate(async (m) => {
    const current = await window.orrery.invoke('settings:get', undefined)
    await window.orrery.invoke('settings:set', {
      ...current,
      editor: { ...current.editor, viewMode: m as 'source' | 'live' | 'reading' }
    })
  }, mode)
  await page.reload()
  await page.waitForSelector('.app', { timeout: 30_000 })
}

/**
 * The nested language parse lands after the card first renders, so a card
 * opened too early carries uncoloured runs into the viewer. Waiting for the
 * colours keeps this about the viewer rather than about parse timing.
 */
async function waitForColouredCard(): Promise<void> {
  await expect(page.locator('.cm-or-code-card')).toBeVisible({ timeout: 15_000 })
  await expect
    .poll(() => page.locator('.cm-or-code-card__pre code span').count(), { timeout: 10_000 })
    .toBeGreaterThan(3)
}

async function openNote(name: string): Promise<void> {
  await page.locator('.tree-row--file', { hasText: name }).click()
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 15_000 })
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-code-card-'))
  writeFileSync(
    join(vault, 'Long.md'),
    '# Long\n\nProse before.\n\n```ts\n' + LONG + '\nconst short = 1\n```\n\nProse after.\n'
  )
  writeFileSync(join(vault, 'Plain.md'), '# Plain\n\nNo code here at all.\n')
  writeFileSync(
    join(vault, 'Diagram.md'),
    '# Diagram\n\n```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```\n\nTail.\n'
  )

  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Long.md')
  await setViewMode('reading')
})

test.afterAll(async () => {
  await app.close()
  rmSync(vault, { recursive: true, force: true })
})

/**
 * A fence is a run of `.cm-line` elements in the editor, and sibling elements
 * cannot share a scrollbar — so in Reading mode it is replaced by one card that
 * can have a scrollbar of its own. Without that, code is never wrapped (by
 * design, so ASCII art survives), and a long line spills out of the card and
 * drags the whole document sideways, prose and headings with it.
 */
test('a long code line scrolls inside its card, not the document', async () => {
  await openNote('Long.md')
  await expect(page.locator('.cm-or-code-card')).toBeVisible({ timeout: 15_000 })

  const m = await page.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller') as HTMLElement
    const pre = document.querySelector('.cm-or-code-card__pre') as HTMLElement
    const heading = document.querySelector('.cm-line') as HTMLElement
    const proseLeft = (): number => heading.getBoundingClientRect().left

    const before = proseLeft()
    pre.scrollLeft = 400
    const movedByCardScroll = Math.round(before - proseLeft())
    const cardScrolledTo = pre.scrollLeft
    pre.scrollLeft = 0

    return {
      // The card has somewhere to scroll...
      cardCanScroll: pre.scrollWidth > pre.clientWidth + 1,
      cardScrolledTo,
      // ...the prose does not move when it does...
      movedByCardScroll,
      // ...and the document has no sideways scroll at all.
      documentExcessWidth: scroller.scrollWidth - scroller.clientWidth
    }
  })

  expect(m.cardCanScroll, 'the card has overflow to scroll').toBe(true)
  expect(m.cardScrolledTo, 'the card actually scrolls').toBe(400)
  expect(m.movedByCardScroll, 'prose stays put while the card scrolls').toBe(0)
  expect(m.documentExcessWidth, 'the document never scrolls sideways').toBe(0)
})

test('a note with no code is unaffected', async () => {
  await openNote('Plain.md')
  await expect(page.locator('.cm-or-code-card')).toHaveCount(0)
  const excess = await page.evaluate(() => {
    const s = document.querySelector('.cm-scroller') as HTMLElement
    return s.scrollWidth - s.clientWidth
  })
  expect(excess).toBe(0)
})

test('the card is coloured by the editor own highlighter', async () => {
  await openNote('Long.md')
  await expect(page.locator('.cm-or-code-card')).toBeVisible({ timeout: 15_000 })
  // The nested language parse lands after the first render, so the card has to
  // redraw to pick the colours up.
  await expect
    .poll(() => page.locator('.cm-or-code-card__pre code span').count(), { timeout: 10_000 })
    .toBeGreaterThan(3)

  const distinct = await page.evaluate(() => {
    const spans = Array.from(document.querySelectorAll('.cm-or-code-card__pre code span'))
    return new Set(spans.map((s) => getComputedStyle(s).color)).size
  })
  expect(distinct, 'keyword, string and number are not all one colour').toBeGreaterThan(1)
})

test('the language badge does not sit on top of the code', async () => {
  await openNote('Long.md')
  await expect(page.locator('.cm-or-code-card__lang')).toBeVisible({ timeout: 15_000 })
  const overlap = await page.evaluate(() => {
    const badge = document.querySelector('.cm-or-code-card__lang')!.getBoundingClientRect()
    const code = document.querySelector('.cm-or-code-card__pre code')!.getBoundingClientRect()
    return badge.bottom > code.top + 1 && badge.right > code.left + 1
  })
  expect(overlap, 'badge sits above the code, not over it').toBe(false)
})

test('a mermaid fence stays a diagram', async () => {
  await openNote('Diagram.md')
  await expect(page.locator('.cm-or-mermaid > svg')).toBeVisible({ timeout: 20_000 })
  // Two block replacements over one range would fight; mermaid keeps its own.
  await expect(page.locator('.cm-or-code-card')).toHaveCount(0)
})

test('the editor keeps its per-line code rendering', async () => {
  await setViewMode('live')
  await openNote('Long.md')
  await expect(page.locator('.cm-or-code-line').first()).toBeVisible({ timeout: 15_000 })
  // Editable code stays real lines — the card is a Reading-mode rendering.
  await expect(page.locator('.cm-or-code-card')).toHaveCount(0)
  await setViewMode('reading')
})

/**
 * A card that scrolls solves a long *line*. A block that is long and wide is
 * still easier read on the whole window — the same reason a diagram can be
 * opened full screen. Code is scaled by type size rather than zoomed: panning
 * text with a drag is the wrong gesture for something you are going to read.
 */
test('a code card opens on the full window', async () => {
  await openNote('Long.md')
  await waitForColouredCard()
  const cardWidth = await page.evaluate(
    () => (document.querySelector('.cm-or-code-card__pre') as HTMLElement).clientWidth
  )

  await page.locator('.cm-or-code-card .cm-or-expand').click()
  await expect(page.locator('.media-viewer__stage--code')).toBeVisible()

  const m = await page.evaluate(() => {
    const stage = document.querySelector('.media-viewer__stage--code') as HTMLElement
    const spans = Array.from(document.querySelectorAll('.media-viewer__code code span'))
    return {
      stageWidth: stage.clientWidth,
      distinctColours: new Set(spans.map((s) => getComputedStyle(s).color)).size,
      tokens: spans.length
    }
  })

  expect(m.stageWidth, 'the window gives the code far more room').toBeGreaterThan(cardWidth * 1.5)
  expect(m.tokens, 'the code is still highlighted').toBeGreaterThan(3)
  expect(m.distinctColours, 'and not all in one colour').toBeGreaterThan(1)

  await page.keyboard.press('Escape')
  await expect(page.locator('.media-viewer__frame')).toBeHidden()
})

test('wrapping the viewer removes the sideways scroll', async () => {
  await openNote('Long.md')
  await waitForColouredCard()
  await page.locator('.cm-or-code-card .cm-or-expand').click()
  await expect(page.locator('.media-viewer__stage--code')).toBeVisible()

  const scrolls = (): Promise<boolean> =>
    page.evaluate(() => {
      const stage = document.querySelector('.media-viewer__stage--code') as HTMLElement
      return stage.scrollWidth > stage.clientWidth + 1
    })

  expect(await scrolls(), 'unwrapped, a long line overflows and scrolls').toBe(true)
  await page.locator('.media-viewer__toggle').click()
  expect(await scrolls(), 'wrapped, there is nothing left to scroll').toBe(false)

  await page.keyboard.press('Escape')
  await expect(page.locator('.media-viewer__frame')).toBeHidden()
})

test('the viewer scales code by type size', async () => {
  await openNote('Long.md')
  await waitForColouredCard()
  await page.locator('.cm-or-code-card .cm-or-expand').click()
  await expect(page.locator('.media-viewer__stage--code')).toBeVisible()

  const size = (): Promise<number> =>
    page.evaluate(() =>
      parseFloat(
        getComputedStyle(document.querySelector('.media-viewer__code') as HTMLElement).fontSize
      )
    )

  const base = await size()
  await page.locator('button[aria-label="Larger text"]').click()
  await page.locator('button[aria-label="Larger text"]').click()
  expect(await size()).toBeGreaterThan(base)

  await page.locator('button[aria-label="Smaller text"]').click()
  await page.locator('button[aria-label="Smaller text"]').click()
  await page.locator('button[aria-label="Smaller text"]').click()
  expect(await size()).toBeLessThan(base)

  await page.keyboard.press('Escape')
  await expect(page.locator('.media-viewer__frame')).toBeHidden()
})

test('the viewer controls are named and big enough to hit', async () => {
  await openNote('Long.md')
  await waitForColouredCard()
  await page.locator('.cm-or-code-card .cm-or-expand').click()
  await expect(page.locator('.media-viewer__stage--code')).toBeVisible()

  // The same two things the UI audit asks of every control, checked here too
  // because the wrap toggle only exists on this presentation.
  const controls = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.media-viewer__bar button')).map((el) => {
      const r = el.getBoundingClientRect()
      return {
        name: (
          el.getAttribute('aria-label') ??
          el.getAttribute('title') ??
          el.textContent ??
          ''
        ).trim(),
        w: Math.round(r.width),
        h: Math.round(r.height)
      }
    })
  )
  expect(controls.length).toBeGreaterThan(3)
  expect(controls.filter((c) => !c.name)).toEqual([])
  expect(controls.filter((c) => c.w < 24 || c.h < 24)).toEqual([])

  await page.keyboard.press('Escape')
  await expect(page.locator('.media-viewer__frame')).toBeHidden()
})
