import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * What the file tree leaves out, and who decides.
 *
 * A vault is somebody's own folder, so both switches start on: a `.gitignore`,
 * a `.github` directory and a generated `dist` are all things people open, and
 * a tree that silently omits them is one you cannot trust to be the folder.
 * Turning either off is a click.
 */

let app: ElectronApplication
let page: Page
let vault: string

const names = (): Promise<string[]> =>
  page
    .locator('.tree-row')
    .evaluateAll((rows) => rows.map((r) => r.textContent?.trim() ?? '').filter((t) => t !== ''))

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-vis-'))
  mkdirSync(join(vault, 'dist'), { recursive: true })
  mkdirSync(join(vault, '.github'), { recursive: true })
  writeFileSync(join(vault, 'Note.md'), '# Note\n')
  writeFileSync(join(vault, '.gitignore'), 'dist/\nsecret.txt\n')
  writeFileSync(join(vault, 'secret.txt'), 'shh\n')
  writeFileSync(join(vault, 'dist', 'bundle.js'), 'x\n')
  writeFileSync(join(vault, '.github', 'ci.yml'), 'on: push\n')
  const git = (...a: string[]): void => execFileSync('git', a, { cwd: vault, stdio: 'ignore' })
  git('init')
  git('config', 'user.email', 'a@b.c')
  git('config', 'user.name', 'A')
  git('add', 'Note.md', '.gitignore')
  git('commit', '-m', 'base')

  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1300, height: 900 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Note.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('shows everything in the folder by default', async () => {
  const listed = await names()
  expect(listed).toContain('Note.md')
  // A dotfile and a dot-directory: both the user's own, both openable.
  expect(listed).toContain('.gitignore')
  expect(listed).toContain('.github')
  // And what git is told to ignore, which is still somebody's build output.
  expect(listed).toContain('dist')
  expect(listed).toContain('secret.txt')
})

test('never shows the version control store, whatever the switches say', async () => {
  // `.git` is the machinery under the folder rather than anything in it.
  expect(await names()).not.toContain('.git')
})

test('hides dotfiles when asked, and leaves the rest alone', async () => {
  await page.getByTitle('Hide dotfiles').click()
  await page.waitForTimeout(800)
  const listed = await names()
  expect(listed).not.toContain('.gitignore')
  expect(listed).not.toContain('.github')
  // Ignored files are a different question and were not asked.
  expect(listed).toContain('dist')
  expect(listed).toContain('Note.md')

  await page.getByTitle('Show dotfiles').click()
  await page.waitForTimeout(800)
  expect(await names()).toContain('.gitignore')
})

test('hides what git ignores when asked, and leaves the rest alone', async () => {
  await page.getByTitle('Hide git-ignored files').click()
  await page.waitForTimeout(900)
  const listed = await names()
  expect(listed).not.toContain('dist')
  expect(listed).not.toContain('secret.txt')
  // Dotfiles are a different question and were not asked.
  expect(listed).toContain('.gitignore')
  expect(listed).toContain('Note.md')

  await page.getByTitle('Show git-ignored files').click()
  await page.waitForTimeout(900)
  expect(await names()).toContain('dist')
})

test('remembers both across a restart of the workspace', async () => {
  await page.getByTitle('Hide dotfiles').click()
  await page.waitForTimeout(600)
  const saved = await page.evaluate(async () => {
    const s = await window.orrery.invoke('settings:get', undefined)
    return s.sidebar
  })
  expect(saved.showHidden).toBe(false)
  expect(saved.showIgnored).toBe(true)
  await page.getByTitle('Show dotfiles').click()
  await page.waitForTimeout(600)
})
