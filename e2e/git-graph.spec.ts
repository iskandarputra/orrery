import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * The commit graph as something you can act on.
 *
 * It drew history and did nothing else: a row was a label with a tooltip. What
 * matters is being able to ask what a commit did and then do something about it.
 */

let app: ElectronApplication
let page: Page
let vault: string

const git = (...args: string[]): string =>
  execFileSync('git', args, { cwd: vault, encoding: 'utf-8' }).trim()

const openGraph = async (): Promise<void> => {
  if (!(await page.locator('.gitgraph').isVisible())) {
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
        commandId: 'view.toggleGit'
      })
    })
    await page.locator('.scm__section', { hasText: 'GRAPH' }).first().click()
  }
  await expect(page.locator('.gitgraph__row').first()).toBeVisible({ timeout: 15_000 })
}

const rowFor = (subject: string): ReturnType<Page['locator']> =>
  page.locator('.gitgraph__row', { hasText: subject })

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-graph-'))
  writeFileSync(join(vault, 'Note.md'), '# Note\n')
  writeFileSync(join(vault, 'kept.md'), 'one\n')
  git('init')
  git('config', 'user.email', 'g@example.com')
  git('config', 'user.name', 'Grapher')
  git('add', '.')
  git('commit', '-m', 'the first commit')

  writeFileSync(join(vault, 'kept.md'), 'one\ntwo\n')
  writeFileSync(join(vault, 'added.md'), 'brand new\n')
  git('add', '.')
  git('commit', '-m', 'second commit with a body', '-m', 'the reason it happened')

  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1360, height: 900 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Note.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('clicking a commit reveals what it did', async () => {
  await openGraph()
  await rowFor('second commit').click()

  // The message body, which the row has never shown.
  await expect(page.locator('.commit-detail__body')).toContainText('the reason it happened')

  // Every file it touched, with the status git reports for each.
  const files = page.locator('.commit-detail__file')
  await expect(files).toHaveCount(2)
  await expect(page.locator('.commit-detail__path', { hasText: 'added.md' })).toBeVisible()
  await expect(
    page.locator('.commit-detail__file', { hasText: 'added.md' }).locator('.commit-detail__status')
  ).toHaveText('A')
  await expect(
    page.locator('.commit-detail__file', { hasText: 'kept.md' }).locator('.commit-detail__status')
  ).toHaveText('M')
})

test('clicking it again collapses it', async () => {
  await rowFor('second commit').click()
  await expect(page.locator('.commit-detail')).toHaveCount(0)
})

test('a file opens that commit diff, against its parent', async () => {
  await rowFor('second commit').click()
  await page.locator('.commit-detail__file', { hasText: 'kept.md' }).click()

  await expect(page.locator('.diff__panes')).toBeVisible({ timeout: 15_000 })
  // Against the parent, which is what "what this commit did" means.
  await expect(page.locator('.diff__heads')).toContainText('parent')
  await expect(page.locator('.diff__heads')).toContainText('this commit')
  await expect(page.locator('.cm-or-diff-line--new')).toContainText('two')

  // History cannot be edited, so the save button is not offered at all.
  await expect(page.locator('.diff__edit', { hasText: 'Save' })).toHaveCount(0)
  await expect(page.locator('.diff__heads')).toContainText('read-only')
  await page.locator('.diff button[aria-label="Close"]').click()
})

test('right-clicking offers the commit actions', async () => {
  await rowFor('second commit').click({ button: 'right' })
  const menu = page.locator('.ctx-menu')
  await expect(menu).toBeVisible({ timeout: 10_000 })
  for (const label of [
    'Copy commit hash',
    'Copy message',
    'Check out',
    'Create branch here',
    'Revert this commit',
    'Cherry-pick'
  ]) {
    await expect(menu).toContainText(label)
  }
  await page.keyboard.press('Escape')
})

test('reverting makes a commit that undoes it', async () => {
  const before = git('rev-parse', 'HEAD')
  await rowFor('second commit').click({ button: 'right' })
  await page.locator('.ctx-menu').getByText('Revert this commit').click()

  await expect.poll(() => git('rev-parse', 'HEAD') !== before, { timeout: 15_000 }).toBe(true)
  // A revert undoes the change and leaves the original in history.
  expect(readFileSync(join(vault, 'kept.md'), 'utf-8')).toBe('one\n')
  expect(git('log', '--oneline')).toContain('second commit')
  await expect(rowFor('Revert').first()).toBeVisible({ timeout: 15_000 })
})

test('creating a branch uses an inline field, since Electron has no prompt', async () => {
  await rowFor('the first commit').click({ button: 'right' })
  await page.locator('.ctx-menu').getByText('Create branch here').click()

  const field = page.locator('.gitgraph__branch-input')
  await expect(field).toBeVisible({ timeout: 10_000 })
  await field.fill('from-the-graph')
  await field.press('Enter')

  await expect
    .poll(() => git('branch', '--show-current'), { timeout: 15_000 })
    .toBe('from-the-graph')
})
