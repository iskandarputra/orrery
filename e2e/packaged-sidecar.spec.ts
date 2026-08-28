import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, test, expect } from '@playwright/test'

/**
 * Proves the sidecar is found in a *packaged* layout.
 *
 * The dev path resolved through `__dirname`; the packaged one resolves through
 * `process.resourcesPath`, and only running the packaged build exercises it.
 * This is the failure the plan called the most likely late surprise.
 */
const PACKAGED = resolve('dist/linux-unpacked/orrery')

// Only meaningful after `npm run build:native && npx electron-builder --linux deb`.
// Skipped otherwise so a plain checkout still runs the suite green.
test.skip(!existsSync(PACKAGED), 'no packaged build in dist/linux-unpacked')

test('the packaged app finds and uses the sidecar', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'orrery-pkg-'))
  writeFileSync(join(vault, 'Index.md'), '# Index\n\nPKGFIND lives here\n')
  writeFileSync(join(vault, 'Other.md'), '# Other\n\nPKGFIND again\nand PKGFIND once more\n')
  const userData = mkdtempSync(join(tmpdir(), 'orrery-pkg-ud-'))

  const app = await electron.launch({
    executablePath: PACKAGED,
    args: ['--no-sandbox', `--user-data-dir=${userData}`],
    env: { ...process.env, ORRERY_HEADLESS: '1', ORRERY_RUST_SEARCH: '1' }
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })

  await page.evaluate(async (v) => {
    const current = await window.orrery.invoke('settings:get', undefined)
    await window.orrery.invoke('settings:set', {
      lastOpenedFolder: v,
      session: { openPaths: [], activePath: '' },
      editor: { ...current.editor, viewMode: 'live' }
    })
  }, vault)
  await page.reload()
  await expect(page.locator('.tree-row--file', { hasText: 'Index.md' })).toBeVisible({
    timeout: 20_000
  })

  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.toggleSearch'
    })
  })
  const input = page.locator('.gsearch__input')
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill('PKGFIND')
  await input.press('Enter')
  await expect(page.locator('.rpanel-count__badge')).toHaveText('3', { timeout: 20_000 })

  // The sidecar is lazily spawned, so by now it must be a live child process.
  // Checked from the test process: the packaged app has no dynamic-import hook.
  const running = execFileSync('bash', ['-c', 'pgrep -fc orrery-sidecar || true']).toString().trim()
  expect(Number(running), 'a sidecar process should be running').toBeGreaterThan(0)

  await app.close()
  rmSync(vault, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})
