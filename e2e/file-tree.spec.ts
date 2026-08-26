import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'zymd-file-tree-'))
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
