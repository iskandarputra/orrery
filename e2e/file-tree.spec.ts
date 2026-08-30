import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-file-tree-'))
  mkdirSync(join(vault, 'Projects', 'Alpha'), { recursive: true })
  mkdirSync(join(vault, 'Projects', 'Beta'), { recursive: true })
  mkdirSync(join(vault, 'Archive'), { recursive: true })
  writeFileSync(join(vault, 'Index.md'), '# Index\n')
  writeFileSync(join(vault, 'Projects', 'Alpha', 'Notes.md'), '# Notes\n')
  writeFileSync(join(vault, 'Projects', 'Beta', 'Plan.md'), '# Plan\n')
  writeFileSync(join(vault, 'Archive', 'Old.md'), '# Old\n')

  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Index.md')
  for (const folder of ['Projects', 'Alpha', 'Beta', 'Archive']) {
    await page.locator('.tree-row--dir', { hasText: folder }).first().click()
    await page.waitForTimeout(150)
  }
  await page.locator('.tree-row--file', { hasText: 'Notes.md' }).click()
  await expect(page.locator('.tree-row--active')).toBeVisible()
})

test.afterAll(async () => {
  await app.close()
  rmSync(vault, { recursive: true, force: true })
})

/** Guide colour and geometry per folder group, read off the rendered tree. */
async function groups(): Promise<
  { folder: string; holdsActive: boolean; guide: string; guideX: number; chevronX: number }[]
> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.tree-dir-group'))
      .map((group) => {
        const children = group.querySelector(':scope > .tree-children')
        const chevron = group.querySelector('.tree-row .tree-chevron-wrap')
        if (!children || !chevron) return null
        const box = chevron.getBoundingClientRect()
        return {
          folder: group.querySelector('.tree-row .tree-label')?.textContent ?? '?',
          holdsActive: !!group.querySelector('.tree-row--active'),
          guide: getComputedStyle(children).borderLeftColor,
          guideX: Math.round(children.getBoundingClientRect().left),
          chevronX: Math.round(box.left + box.width / 2)
        }
      })
      .filter((g): g is NonNullable<typeof g> => g !== null)
  )
}

test("each level's guide descends from its folder's chevron", async () => {
  const rows = await groups()
  expect(rows.length).toBeGreaterThan(2)
  // A guide offset from the chevron reads as a line floating beside the tree
  // rather than one descending from the folder it belongs to.
  for (const row of rows) expect(row.guideX, row.folder).toBe(row.chevronX)
})

test('the branch holding the open note is the only one lit', async () => {
  const rows = await groups()
  const lit = rows.filter((r) => r.holdsActive)
  const quiet = rows.filter((r) => !r.holdsActive)
  expect(lit.length).toBeGreaterThan(1) // the whole chain from root, not just the leaf
  expect(quiet.length).toBeGreaterThan(0)

  // The chain is one colour, the rest another — that contrast is the whole point.
  expect(new Set(lit.map((r) => r.guide)).size).toBe(1)
  for (const row of quiet) expect(row.guide, row.folder).not.toBe(lit[0]!.guide)
})

test('opening a note in another branch moves the highlight', async () => {
  const before = (await groups()).filter((r) => r.holdsActive).map((r) => r.folder)
  await page.locator('.tree-row--file', { hasText: 'Old.md' }).click()
  await page.waitForTimeout(250)
  const after = (await groups()).filter((r) => r.holdsActive).map((r) => r.folder)

  expect(before).toContain('Alpha')
  expect(after).toContain('Archive')
  expect(after).not.toContain('Alpha')
})

test('a folder is read when it is opened, not before', async () => {
  // The tree used to be read to the bottom before the window could show
  // anything, which on a real folder — 59,000 directories, 365,000 files — was
  // eight seconds and seventy megabytes of JSON.
  //
  // What this covers is the behaviour from outside: a folder opens and its
  // contents appear, one level at a time. It cannot see whether the data was
  // fetched lazily, because a collapsed folder renders nothing either way —
  // `file-system.test.ts` is where the shallow read itself is pinned down.
  const fresh = mkdtempSync(join(tmpdir(), 'orrery-lazy-'))
  mkdirSync(join(fresh, 'Deep', 'Deeper'), { recursive: true })
  writeFileSync(join(fresh, 'Top.md'), '# Top\n')
  writeFileSync(join(fresh, 'Deep', 'Middle.md'), '# Middle\n')
  writeFileSync(join(fresh, 'Deep', 'Deeper', 'Bottom.md'), '# Bottom\n')

  await openVault(page, fresh, 'Top.md')
  await expect(page.locator('.tree-row--dir', { hasText: 'Deep' })).toBeVisible({ timeout: 15_000 })
  // Present but unread: the folder is there and nothing inside it is.
  await expect(page.locator('.tree-row--file', { hasText: 'Middle.md' })).toHaveCount(0)

  await page.locator('.tree-row--dir', { hasText: 'Deep' }).first().click()
  await expect(page.locator('.tree-row--file', { hasText: 'Middle.md' })).toBeVisible({
    timeout: 10_000
  })
  // One level at a time: opening a folder does not read its children's children.
  await expect(page.locator('.tree-row--file', { hasText: 'Bottom.md' })).toHaveCount(0)

  await page.locator('.tree-row--dir', { hasText: 'Deeper' }).first().click()
  await expect(page.locator('.tree-row--file', { hasText: 'Bottom.md' })).toBeVisible({
    timeout: 10_000
  })

  rmSync(fresh, { recursive: true, force: true })
})

test('a note in a folder nobody has opened can still be found by name', async () => {
  // The index is what quick open and wikilinks resolve against, and it cannot
  // come from the tree any more: the tree only knows the parts somebody has
  // expanded. A note three folders down has to be findable without going and
  // looking for it first.
  const fresh = mkdtempSync(join(tmpdir(), 'orrery-index-'))
  mkdirSync(join(fresh, 'A', 'B', 'C'), { recursive: true })
  writeFileSync(join(fresh, 'Start.md'), '# Start\n')
  writeFileSync(join(fresh, 'A', 'B', 'C', 'Buried.md'), '# Buried\n')

  await openVault(page, fresh, 'Start.md')
  await expect(page.locator('.tree-row--dir', { hasText: 'A' }).first()).toBeVisible({
    timeout: 15_000
  })
  await expect(page.locator('.tree-row--file', { hasText: 'Buried.md' })).toHaveCount(0)

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'app.quickOpen'
    })
  })
  await page.locator('.palette__input').fill('Buried')
  await expect(page.locator('.palette__item').first()).toContainText('Buried.md', {
    timeout: 15_000
  })
  await page.keyboard.press('Escape')

  rmSync(fresh, { recursive: true, force: true })
})

test('a file created on disk appears in the folder that is open', async () => {
  // The watcher used to follow every directory in the vault; it now follows the
  // ones on screen, which is what the tree can show a change in anyway. The
  // contract that matters is unchanged: put a file there and it turns up.
  const fresh = mkdtempSync(join(tmpdir(), 'orrery-watch-'))
  mkdirSync(join(fresh, 'Watched'), { recursive: true })
  writeFileSync(join(fresh, 'Root.md'), '# Root\n')
  writeFileSync(join(fresh, 'Watched', 'One.md'), '# One\n')

  await openVault(page, fresh, 'Root.md')
  await page.locator('.tree-row--dir', { hasText: 'Watched' }).first().click()
  await expect(page.locator('.tree-row--file', { hasText: 'One.md' })).toBeVisible({
    timeout: 15_000
  })

  writeFileSync(join(fresh, 'Watched', 'Two.md'), '# Two\n')
  await expect(page.locator('.tree-row--file', { hasText: 'Two.md' })).toBeVisible({
    timeout: 20_000
  })

  // And in the root, which is watched from the moment the vault opens.
  writeFileSync(join(fresh, 'Three.md'), '# Three\n')
  await expect(page.locator('.tree-row--file', { hasText: 'Three.md' })).toBeVisible({
    timeout: 20_000
  })

  rmSync(fresh, { recursive: true, force: true })
})
