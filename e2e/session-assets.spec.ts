import { mkdtempSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { closeCleanly, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

/** A 1×1 PNG, as a clipboard image would arrive. */
const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'zymd-session-'))
  writeFileSync(join(vault, 'One.md'), '# One\n')
  writeFileSync(join(vault, 'Two.md'), '# Two\n')
  writeFileSync(join(vault, 'Three.md'), '# Three\n')
  app = await electron.launch({
    args: ['./out/main/index.js', '--no-sandbox'],
    env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' }
  })
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'One.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('reopens last session tabs after a restart', async () => {
  for (const name of ['One.md', 'Two.md', 'Three.md']) {
    await page.locator('.tree-row--file', { hasText: name }).click()
    await expect(page.locator('.tab--active .tab__label')).toHaveText(name)
  }
  await page.locator('.tree-row--file', { hasText: 'Two.md' }).click()
  // The session is written debounced; give it a moment.
  await page.waitForTimeout(800)

  // A reload is the renderer equivalent of relaunching.
  await page.reload()
  await expect(page.locator('.tab')).toHaveCount(3, { timeout: 15_000 })
  await expect(page.locator('.tab--active .tab__label')).toHaveText('Two.md')
})

test('closing a tab is remembered too', async () => {
  await page.locator('.tab', { hasText: 'Three.md' }).locator('.tab__close').click()
  await expect(page.locator('.tab')).toHaveCount(2)
  await page.waitForTimeout(800)

  await page.reload()
  await expect(page.locator('.tab')).toHaveCount(2, { timeout: 15_000 })
  await expect(page.locator('.tab', { hasText: 'Three.md' })).toHaveCount(0)
})

test('a pasted image is filed into the vault and embedded', async () => {
  await page.locator('.tree-row--file', { hasText: 'One.md' }).click()
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')

  // Synthesise a clipboard paste carrying a PNG file.
  await page.locator('.cm-content').evaluate(async (el, base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const file = new File([bytes], 'image.png', { type: 'image/png' })
    const data = new DataTransfer()
    data.items.add(file)
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
  }, PNG_BASE64)

  // The caret lands after the insert, and live preview shows source on the
  // active line — move away before expecting the rendered image.
  await expect(page.locator('.cm-content')).toContainText('assets/Pasted%20image', {
    timeout: 10_000
  })
  await page.keyboard.press('Control+Home')
  await expect(page.locator('.cm-zy-image img')).toBeVisible({ timeout: 10_000 })

  const assets = readdirSync(join(vault, 'assets'))
  expect(assets).toHaveLength(1)
  expect(assets[0]).toMatch(/^Pasted image .*\.png$/)
  expect(existsSync(join(vault, 'assets', assets[0]!))).toBe(true)

  // The image actually decoded — the %20 in the link resolved to the real file.
  await expect
    .poll(() =>
      page.locator('.cm-zy-image img').evaluate((el: HTMLImageElement) => el.naturalWidth)
    )
    .toBeGreaterThan(0)
  await expect(page.locator('.tab__close--dirty')).toBeVisible()
})
