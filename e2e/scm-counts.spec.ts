import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * How much has changed, said without opening anything.
 *
 * The Changes header gives the totals, lines and files, and the source control
 * icon carries the number of changed files the way VS Code's does. The icon is
 * the one that matters most here, because it is on screen while the panel is
 * not: the status it counts is read with the vault, not with the panel.
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

const icon = () =>
  page.locator(
    '.sidebar-rail__btn[data-tip^="Source Control"], .sidebar-rail__btn[data-tip^="Hide Source Control"]'
  )
const badge = () => icon().locator('.sidebar-rail__badge')
const summary = () => page.locator('.scm__section', { hasText: 'Changes' }).locator('.scm__summary')

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-scm-counts-'))
  mkdirSync(join(vault, 'deep', 'inner'), { recursive: true })
  writeFileSync(join(vault, 'Index.md'), '# Index\n')
  writeFileSync(join(vault, 'a.md'), 'one\ntwo\nthree\n')
  writeFileSync(join(vault, 'b.md'), 'one\ntwo\n')
  writeFileSync(join(vault, 'deep', 'inner', 'keep.md'), 'kept\n')
  git('init', '-q', '.')
  git('add', '.')
  git('commit', '-qm', 'base')

  // a.md: one line rewritten, unstaged.            +1 -1
  writeFileSync(join(vault, 'a.md'), 'one\nTWO\nthree\n')
  // b.md: two lines staged, then one more edit.   staged +2, unstaged +1
  writeFileSync(join(vault, 'b.md'), 'one\ntwo\nthree\nfour\n')
  git('add', 'b.md')
  writeFileSync(join(vault, 'b.md'), 'one\ntwo\nthree\nfour\nfive\n')
  // c.md: new and untracked.                       +4
  writeFileSync(join(vault, 'c.md'), '1\n2\n3\n4\n')

  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Index.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('the icon counts changed files with the file tree on screen', async () => {
  await expect(page.locator('.tree-row--file', { hasText: 'Index.md' })).toBeVisible()
  await expect(page.locator('.scm')).toHaveCount(0)
  // Three files, though b.md is listed twice in the panel, staged and not.
  await expect(badge()).toHaveText('3', { timeout: 15_000 })
  await expect(icon()).toHaveAttribute('aria-label', /\(3 changed files\)/)
})

test('the Changes header totals what the rows add up to', async () => {
  await runCommand('view.toggleGit')
  await expect(summary()).toContainText('3 files', { timeout: 15_000 })
  await expect(summary().locator('.scm-count__add')).toHaveText('+8', { timeout: 15_000 })
  await expect(summary().locator('.scm-count__del')).toHaveText('-1')

  // Checked against the column itself, not only against the arithmetic above.
  const rows = await page.evaluate(() => {
    const sum = (sel: string): number =>
      Array.from(document.querySelectorAll(`.scm-row ${sel}`)).reduce(
        (n, el) => n + Math.abs(Number(el.textContent)),
        0
      )
    return { add: sum('.scm-count__add'), del: sum('.scm-count__del') }
  })
  expect(rows).toEqual({ add: 8, del: 1 })

  // On the right of the header, and still there with the section closed.
  const placed = await page.evaluate(() => {
    const header = document.querySelector('.scm__section')!.getBoundingClientRect()
    const totals = document.querySelector('.scm__summary')!.getBoundingClientRect()
    return { gap: header.right - totals.right, header: header.width }
  })
  expect(placed.gap).toBeLessThan(16)
  await page.locator('.scm__section', { hasText: 'Changes' }).click()
  await expect(summary()).toContainText('3 files')
  await page.locator('.scm__section', { hasText: 'Changes' }).click()
})

test('the icon follows changes made outside the app without the panel open', async () => {
  // Back to the files, so nothing on screen is reading status for itself.
  await runCommand('view.toggleGit')
  await expect(page.locator('.scm')).toHaveCount(0)
  await expect(badge()).toHaveText('3', { timeout: 15_000 })

  // A commit in a terminal: a.md is done, b.md keeps its second edit.
  git('add', 'a.md')
  git('commit', '-qm', 'from a terminal')
  await expect(badge()).toHaveText('2', { timeout: 10_000 })

  // A file written by another program in a folder nothing watches, heard when
  // the window comes back.
  writeFileSync(join(vault, 'deep', 'inner', 'elsewhere.md'), 'x\n')
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(badge()).toHaveText('3', { timeout: 10_000 })

  // Everything committed: no count at all, not a zero.
  git('add', '-A')
  git('commit', '-qm', 'the rest')
  await expect(badge()).toHaveCount(0, { timeout: 10_000 })
  await expect(icon()).toHaveAttribute('aria-label', 'Source Control')
})
