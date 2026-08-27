import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

const NOTE = `# Title

Intro paragraph.

## First section

Body.

### Nested heading

More body.

## Second section

Body.
`

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-rpanel-'))
  writeFileSync(join(vault, 'Note.md'), NOTE)
  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Note.md')
  await page.locator('.tree-row--file', { hasText: 'Note.md' }).click()
  await page.waitForTimeout(500)
})

test.afterAll(async () => {
  await app.close()
  rmSync(vault, { recursive: true, force: true })
})

test('a first run opens on the outline', async () => {
  await expect(page.locator('.rpanel')).toBeVisible()
  await expect(page.locator('.rpanel__tab--active')).toHaveText('Outline')
  // Showing the panel is not the same as showing the note's structure in it:
  // one H1, two H2s and an H3.
  await expect(page.locator('.outline__item')).toHaveCount(4)
})

test('closing the panel is remembered across a restart', async () => {
  await page.locator('.rpanel__close-btn').click()
  await expect(page.locator('.rpanel')).toBeHidden()

  await page.reload()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await page.waitForTimeout(600)
  // The default only applies to a first run; a deliberate close has to stick.
  await expect(page.locator('.rpanel')).toBeHidden()
})

test('the tab row scrolls sideways instead of squashing its tabs', async () => {
  // Reopen through the same path a user would.
  await page.evaluate(async () => {
    const current = await window.orrery.invoke('settings:get', undefined)
    await window.orrery.invoke('settings:set', {
      ...current,
      rightPanel: { ...current.rightPanel, panel: 'outline', width: 220 }
    })
  })
  await page.reload()
  await page.waitForSelector('.rpanel', { timeout: 30_000 })
  await page.waitForTimeout(500)

  const row = await page.evaluate(() => {
    const scroll = document.querySelector('.rpanel__tabs-scroll') as HTMLElement
    const close = document.querySelector('.rpanel__close-btn') as HTMLElement
    const tabs = Array.from(document.querySelectorAll('.rpanel__tab')) as HTMLElement[]
    const closeBefore = Math.round(close.getBoundingClientRect().left)

    // Overflow alone proves nothing — a row that simply spills over its
    // container also reports scrollWidth > clientWidth. What matters is that
    // it *moves*, which only a scrollable box does.
    scroll.scrollLeft = scroll.scrollWidth
    const scrolled = scroll.scrollLeft

    const lastTab = tabs[tabs.length - 1]!.getBoundingClientRect()
    const box = scroll.getBoundingClientRect()
    return {
      overflowing: scroll.scrollWidth > scroll.clientWidth + 1,
      scrolled,
      lastTabReachable: lastTab.right <= box.right + 1 && lastTab.left >= box.left - 1,
      // Every tab keeps its natural width; a squashed row would clip labels.
      clipped: tabs.filter((t) => t.scrollWidth > t.clientWidth + 1).length,
      rows: new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top))).size,
      closeMoved: Math.round(close.getBoundingClientRect().left) !== closeBefore
    }
  })

  expect(row.overflowing, 'seven tabs should not fit a 220px panel').toBe(true)
  expect(row.scrolled, 'the row should actually scroll, not just overflow').toBeGreaterThan(0)
  expect(row.lastTabReachable, 'scrolling should reach the last tab').toBe(true)
  expect(row.clipped, 'tabs keep their own width').toBe(0)
  expect(row.rows, 'tabs stay on one row').toBe(1)
  expect(row.closeMoved, 'the close button is pinned, not carried off').toBe(false)
})

test('the row fades only the edge it can still travel toward', async () => {
  const at = async (position: 'start' | 'end'): Promise<string> =>
    page.evaluate((where) => {
      const row = document.querySelector('.rpanel__tabs-scroll') as HTMLElement
      row.scrollLeft = where === 'start' ? 0 : row.scrollWidth
      row.dispatchEvent(new Event('scroll'))
      return row.dataset['overflow'] ?? ''
    }, position)

  // Fading an edge with nothing behind it would dim a tab for no reason.
  expect(await at('start')).toBe('right')
  expect(await at('end')).toBe('left')
})

test('the selected tab is scrolled into view when it changes', async () => {
  // Tags is the last tab, off the end of a 220px row.
  await page.locator('.rpanel__tab', { hasText: 'Tags' }).click()
  await page.waitForTimeout(300)

  const visible = await page.evaluate(() => {
    const scroll = document.querySelector('.rpanel__tabs-scroll')!.getBoundingClientRect()
    const active = document.querySelector('.rpanel__tab--active')!.getBoundingClientRect()
    return active.left >= scroll.left - 1 && active.right <= scroll.right + 1
  })
  expect(visible, 'the active tab should be inside the visible row').toBe(true)
})
