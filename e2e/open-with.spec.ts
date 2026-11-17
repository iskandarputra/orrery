import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import electronEntry from 'electron'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, launchEnv, openVault, LAUNCH_ARGS } from './helpers'

/**
 * Opening a file from outside the app: a double-click, a file manager's "Open
 * With", a path typed after the command.
 *
 * None of it worked. Main never looked at `process.argv` and `second-instance`
 * only focused the window, so the app either started and showed the last
 * session as if nothing had been asked of it, or came to the front with the
 * file it was handed dropped on the floor. The desktop entry ends in `%U`, so
 * what arrives is usually a percent-encoded `file://` URI rather than a path,
 * which is the other half of why nothing happened.
 */

/** The `electron` package's main export is the path to the binary, not the API. */
const electronBinary = electronEntry as unknown as string

let vault: string
let outside: string
let plainFile: string
let spacedFile: string

let app: ElectronApplication | null = null
let page: Page

async function start(args: string[], userData?: string): Promise<Page> {
  app = await launchApp({ args, ...(userData ? { userData } : {}) })
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  return page
}

async function stop(): Promise<void> {
  if (app) await closeCleanly(app, page)
  app = null
}

test.beforeAll(() => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-openwith-'))
  outside = mkdtempSync(join(tmpdir(), 'orrery-elsewhere-'))
  writeFileSync(join(vault, 'Note.md'), '# Note\n')
  plainFile = join(outside, 'jobs-arch.txt')
  spacedFile = join(outside, 'my notes.md')
  writeFileSync(plainFile, 'the architecture of the jobs service\n')
  writeFileSync(spacedFile, '# spaced\n')
})

test.afterEach(async () => {
  await stop()
})

test.afterAll(() => {
  rmSync(vault, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

test('a path after the command opens that file', async () => {
  await start([plainFile])
  await expect(page.locator('.tab--active')).toContainText('jobs-arch', { timeout: 20_000 })
})

test('a file:// URI is what a file manager actually sends, spaces and all', async () => {
  const uri = pathToFileURL(spacedFile).href
  // The escaping is the point: without decoding, the path has a literal %20 in
  // it and the open fails on a file that is plainly there.
  expect(uri).toContain('%20')

  await start([uri])
  await expect(page.locator('.tab--active')).toContainText('my notes', { timeout: 20_000 })
})

test('the file lands in front of the session, not behind it', async () => {
  // The half of this that a "does it open?" test misses. `openPaths` shows the
  // last file it opens, so a file delivered before the session restore is
  // opened into a tab nobody can see, which reads as it not having opened.
  const userData = mkdtempSync(join(tmpdir(), 'orrery-openwith-ud-'))
  try {
    await start([], userData)
    await openVault(page, vault, 'Note.md')
    await page.locator('.tree-row--file', { hasText: 'Note.md' }).click()
    await expect(page.locator('.tab--active')).toContainText('Note')
    // The session is debounced on both sides of the boundary, so quitting the
    // moment the tab appears quits before there is a session to come back to.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const settings = await window.orrery.invoke('settings:get', undefined)
            return settings.session.openPaths
          }),
        { timeout: 10_000 }
      )
      .toContain(join(vault, 'Note.md'))
    await stop()

    await start([plainFile], userData)
    // The session came back...
    await expect(page.locator('.tab', { hasText: 'Note' })).toBeVisible({ timeout: 20_000 })
    // ...and the file that was asked for is the one on screen.
    await expect(page.locator('.tab--active')).toContainText('jobs-arch')
  } finally {
    await stop()
    rmSync(userData, { recursive: true, force: true })
  }
})

test('a second launch hands its file to the window already open', async () => {
  const userData = mkdtempSync(join(tmpdir(), 'orrery-openwith-second-'))
  try {
    await start([], userData)
    // No tab bar at all yet: a fresh profile opens no vault and no file.
    await expect(page.locator('.tab', { hasText: 'jobs-arch' })).toHaveCount(0)

    // A real second process, refused the single-instance lock, exactly as a
    // file manager's "Open With" starts one while the app is already running.
    const second = spawn(
      electronBinary,
      [
        './out/main/index.js',
        ...LAUNCH_ARGS,
        `--user-data-dir=${userData}`,
        pathToFileURL(plainFile).href
      ],
      { env: launchEnv(), stdio: 'ignore' }
    )
    await new Promise<void>((resolve) => second.once('exit', () => resolve()))

    await expect(page.locator('.tab--active')).toContainText('jobs-arch', { timeout: 20_000 })
  } finally {
    await stop()
    rmSync(userData, { recursive: true, force: true })
  }
})

test('a folder opens as the vault', async () => {
  await start([vault])
  await expect(page.locator('.tree-row--file', { hasText: 'Note.md' })).toBeVisible({
    timeout: 20_000
  })
})
