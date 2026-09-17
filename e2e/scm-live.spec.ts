import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * Source control as something that keeps up.
 *
 * Two complaints. The change list and the graph were an accordion, so one was
 * always hidden. And the panel read status when it opened and when one of its
 * own buttons was pressed, so a commit made in a terminal, or a note saved in a
 * folder the tree had closed, left it wrong until Refresh. None of the tests
 * below press Refresh.
 */
let app: ElectronApplication
let page: Page
let vault: string

const git = (...args: string[]): void => {
  execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
    cwd: vault,
    stdio: 'ignore'
  })
}

async function runCommand(commandId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

async function openPanel(): Promise<void> {
  if (!(await page.locator('.scm').isVisible())) await runCommand('view.toggleGit')
  await expect(page.locator('.scm__section').first()).toBeVisible({ timeout: 15_000 })
}

/** A section's toggle, found by name rather than text: "Staged Changes" contains "Changes". */
const section = (name: 'Changes' | 'Graph') =>
  page.locator(`[data-section="${name.toLowerCase()}"] .scm__section-toggle`)
const row = (name: string) => page.locator('.scm-row__name', { hasText: name })

/** Open or close a section, whichever state it is in now. */
async function setSection(name: 'Changes' | 'Graph', open: boolean): Promise<void> {
  if ((await section(name).getAttribute('aria-expanded')) !== String(open)) {
    await section(name).click()
  }
  await expect(section(name)).toHaveAttribute('aria-expanded', String(open))
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-scm-live-'))
  mkdirSync(join(vault, 'deep', 'inner'), { recursive: true })
  writeFileSync(join(vault, 'Index.md'), '# Index\n')
  writeFileSync(join(vault, 'deep', 'inner', 'Buried.md'), '# Buried\n')
  git('init', '-q', '.')
  git('add', '.')
  git('commit', '-qm', 'base')
  // Enough history that the graph has to scroll in its share of the panel.
  for (let i = 1; i <= 40; i++) {
    writeFileSync(join(vault, 'Index.md'), `# Index\n\nrevision ${i}\n`)
    git('commit', '-qam', `revision ${i}`)
  }
  // And enough changes that the list has to be held to its share.
  for (let i = 1; i <= 25; i++) writeFileSync(join(vault, `Changed${i}.md`), `change ${i}\n`)

  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1300, height: 800 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Index.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('the changes and the history are on screen together', async () => {
  await openPanel()
  await expect(row('Changed1.md')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.gitgraph__row').first()).toBeVisible({ timeout: 15_000 })

  const layout = await page.evaluate(() => {
    const box = (sel: string) => document.querySelector(sel)!.getBoundingClientRect()
    const scm = box('.scm')
    const changes = document.querySelector('.scm__body')!
    const graph = document.querySelector('.gitgraph')!
    const visible = (el: Element): number => {
      const r = el.getBoundingClientRect()
      return Math.max(0, Math.min(r.bottom, scm.bottom) - Math.max(r.top, scm.top))
    }
    return {
      panel: scm.height,
      changesShown: visible(changes),
      graphShown: visible(graph),
      changesScrolls: changes.scrollHeight > changes.clientHeight,
      graphScrolls: graph.scrollHeight > graph.clientHeight,
      // Nothing of the panel hangs below the window.
      panelFits: scm.bottom <= window.innerHeight + 1
    }
  })
  expect(layout.panelFits).toBe(true)
  // Each has real room, not a sliver, and each scrolls within it.
  expect(layout.changesShown).toBeGreaterThan(100)
  expect(layout.graphShown).toBeGreaterThan(100)
  expect(layout.changesScrolls).toBe(true)
  expect(layout.graphScrolls).toBe(true)
  // A long list is held to half, so the history is never squeezed out.
  expect(layout.changesShown).toBeLessThanOrEqual(layout.panel / 2 + 1)
})

test('each section opens and closes on its own, and stays as it was left', async () => {
  await openPanel()
  await setSection('Graph', false)
  await expect(page.locator('.gitgraph')).toBeHidden()
  await expect(row('Changed1.md')).toBeVisible()

  await setSection('Changes', false)
  await setSection('Graph', true)
  await expect(page.locator('.gitgraph__row').first()).toBeVisible({ timeout: 15_000 })
  await expect(row('Changed1.md')).toBeHidden()

  // Remembered: a reload brings back the sections as they were.
  await page.reload()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openPanel()
  await expect(section('Changes')).toHaveAttribute('aria-expanded', 'false')
  await expect(section('Graph')).toHaveAttribute('aria-expanded', 'true')

  await setSection('Changes', true)
  await expect(row('Changed1.md')).toBeVisible({ timeout: 15_000 })
})

test('a commit made outside the app shows in both sections without a refresh', async () => {
  await openPanel()
  await expect(row('Changed1.md')).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.gitgraph')).not.toContainText('committed in a terminal')

  git('add', 'Changed1.md', 'Changed2.md')
  git('commit', '-qm', 'committed in a terminal')

  await expect(row('Changed1.md')).toHaveCount(0, { timeout: 10_000 })
  await expect(row('Changed2.md')).toHaveCount(0)
  await expect(page.locator('.gitgraph')).toContainText('committed in a terminal', {
    timeout: 10_000
  })
})

test('a note saved in a folder the tree has closed shows without a refresh', async () => {
  await openPanel()
  await expect(row('Buried.md')).toHaveCount(0)

  // Quick open, so the folder it lives in is never expanded or watched.
  await runCommand('app.quickOpen')
  await page.locator('.palette__input').fill('Buried')
  await expect(page.locator('.palette__item').first()).toContainText('Buried.md', {
    timeout: 15_000
  })
  await page.keyboard.press('Enter')
  await expect(page.locator('.tab--active')).toContainText('Buried', { timeout: 15_000 })
  await page.locator('.cm-content').first().click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('\nedited here')
  await runCommand('file.save')

  await expect(row('Buried.md')).toBeVisible({ timeout: 10_000 })
})

test('a file changed elsewhere shows when the window comes back', async () => {
  await openPanel()
  await expect(row('Elsewhere.md')).toHaveCount(0)
  // Written by some other program, in a folder nothing watches.
  writeFileSync(join(vault, 'deep', 'inner', 'Elsewhere.md'), 'from another editor\n')
  // Not on its own: nothing in the app can hear this write.
  await page.waitForTimeout(1500)
  await expect(row('Elsewhere.md')).toHaveCount(0)

  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(row('Elsewhere.md')).toBeVisible({ timeout: 10_000 })
})
