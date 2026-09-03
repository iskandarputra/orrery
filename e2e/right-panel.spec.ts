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
  await expect(page.locator('.rpanel__tab--active')).toHaveAttribute('aria-label', 'Outline')
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

test('the rail shows every view at once, in a column', async () => {
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

  const rail = await page.evaluate(() => {
    const nav = document.querySelector('.rpanel-rail') as HTMLElement
    const tabs = Array.from(document.querySelectorAll('.rpanel__tab')) as HTMLElement[]
    const box = nav.getBoundingClientRect()
    return {
      count: tabs.length,
      // A column, not a row: every tab on its own line.
      columns: new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().left))).size,
      lines: new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top))).size,
      // All of them at once, which is the reason for the change: the old row
      // could not fit them at this width and scrolled sideways to cope.
      allInside: tabs.every(
        (t) =>
          t.getBoundingClientRect().top >= box.top - 1 &&
          t.getBoundingClientRect().bottom <= box.bottom + 1
      ),
      scrolls: nav.scrollHeight > nav.clientHeight + 1,
      // WCAG 2.5.8.
      tooSmall: tabs.filter((t) => {
        const r = t.getBoundingClientRect()
        return r.width < 24 || r.height < 24
      }).length
    }
  })

  // Ten, not eleven: source control moved to the left sidebar, beside the file
  // tree its work is done on.
  expect(rail.count, 'every view has a tab').toBe(10)
  expect(rail.columns, 'the rail is one column').toBe(1)
  expect(rail.lines, 'each tab on its own line').toBe(10)
  expect(rail.allInside, 'all of them fit at the panel minimum width').toBe(true)
  expect(rail.scrolls, 'the column does not need to scroll').toBe(false)
  expect(rail.tooSmall, 'each tab is a 24px target').toBe(0)
})

/**
 * The rail is an activity bar, not the panel's own header: closing the panel
 * must not take the way back with it.
 */
test('the left rail outlives the sidebar and brings it back', async () => {
  // The same bargain the right-hand rail makes: closing the file tree should
  // not cost you the way back into it.
  await expect(page.locator('.sidebar')).toBeVisible()
  await page.locator('.sidebar-rail__btn[aria-label*="Hide files"]').click()
  await expect(page.locator('.sidebar')).toHaveCount(0)
  await expect(page.locator('.sidebar-rail')).toBeVisible()

  await page.locator('.sidebar-rail__btn[aria-label*="Show files"]').click()
  await expect(page.locator('.sidebar')).toBeVisible()
})

test('the sidebar drag follows the pointer and saves once', async () => {
  const widthOf = (): Promise<number> =>
    page.locator('.sidebar').evaluate((el) => el.getBoundingClientRect().width)
  const before = await widthOf()

  const handle = (await page.locator('.sidebar__resizer').boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(handle.x + 120, handle.y + handle.height / 2, { steps: 10 })

  // Still mid-drag: the element has moved, and nothing has been written.
  await expect.poll(widthOf).toBeGreaterThan(before + 90)
  const midDrag = await page.evaluate(async () => {
    const settings = await window.orrery.invoke('settings:get', undefined)
    return settings.sidebar.width
  })
  expect(midDrag).toBe(before)

  await page.mouse.up()
  await expect
    .poll(async () => {
      const settings = await page.evaluate(() => window.orrery.invoke('settings:get', undefined))
      return settings.sidebar.width
    })
    .toBeGreaterThan(before + 90)
})

test('the rail outlives the panel and reopens it', async () => {
  await page.locator('.rpanel__close-btn').click()
  await expect(page.locator('.rpanel')).toBeHidden()
  await expect(page.locator('.rpanel-rail')).toBeVisible()

  await page.locator('.rpanel__tab[aria-label="Search"]').click()
  await expect(page.locator('.rpanel')).toBeVisible()
  await expect(page.locator('.rpanel__tab--active')).toHaveAttribute('aria-label', 'Search')

  // And the same icon closes it again, the way clicking the open view does.
  await page.locator('.rpanel__tab[aria-label="Search"]').click()
  await expect(page.locator('.rpanel')).toBeHidden()
  await page.locator('.rpanel__tab[aria-label="Outline"]').click()
  await expect(page.locator('.rpanel')).toBeVisible()
})
