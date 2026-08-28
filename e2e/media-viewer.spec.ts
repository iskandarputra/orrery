import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-media-probe-'))
  const redPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAAK0lEQVR4nO3BMQEAAADCoPVPbQ0PoAAAAAAAAAAAAAAAAAAAAAAAAAB4GxAAAAHmVwZ/AAAAAElFTkSuQmCC',
    'base64'
  )
  writeFileSync(join(vault, 'pic.png'), redPng)
  writeFileSync(
    join(vault, 'Diagram.md'),
    '# Diagram\n\n```mermaid\nflowchart LR\n  A[Start] --> B[Middle]\n  B --> C[End]\n```\n\nAn image: ![red](pic.png)\n\n$$\n\\int_0^1 x^2 dx = \\frac{1}{3}\n$$\n\nTail.\n'
  )
  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Diagram.md')
})

test.afterAll(async () => {
  await app.close()
  rmSync(vault, { recursive: true, force: true })
})

test('mermaid renders and every block gets an expand control', async () => {
  await page.locator('.tree-row--file', { hasText: 'Diagram.md' }).click()
  await expect(page.locator('.cm-or-mermaid > svg')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.cm-or-mermaid .cm-or-expand')).toHaveCount(1)
  await expect(page.locator('.cm-or-image .cm-or-expand')).toHaveCount(1)
  await expect(page.locator('.cm-or-math--block .cm-or-expand')).toHaveCount(1)
})

test('the expand control opens the viewer, and the diagram is bigger in it', async () => {
  await page.locator('.tree-row--file', { hasText: 'Diagram.md' }).click()
  await expect(page.locator('.cm-or-mermaid > svg')).toBeVisible({ timeout: 20_000 })

  const inline = await page
    .locator('.cm-or-mermaid > svg')
    .evaluate((el) => el.getBoundingClientRect().width)

  await page.locator('.cm-or-mermaid .cm-or-expand').click()

  await expect(page.locator('.media-viewer__frame')).toBeVisible()
  await expect(page.locator('.media-viewer__content svg')).toBeVisible({ timeout: 20_000 })
  const enlarged = await page
    .locator('.media-viewer__content svg')
    .evaluate((el) => el.getBoundingClientRect().width)

  expect(enlarged).toBeGreaterThan(inline)

  await page.keyboard.press('Escape')
  await expect(page.locator('.media-viewer__frame')).toBeHidden()
})

test('expanding does not move the caret into the source', async () => {
  await page.locator('.tree-row--file', { hasText: 'Diagram.md' }).click()
  await expect(page.locator('.cm-or-mermaid > svg')).toBeVisible({ timeout: 20_000 })
  await page.locator('.cm-or-mermaid .cm-or-expand').click()
  await expect(page.locator('.media-viewer__frame')).toBeVisible()
  await page.keyboard.press('Escape')
  // If the click had fallen through to the widget, the fence would have been
  // revealed as source and the rendered diagram would be gone.
  await expect(page.locator('.cm-or-mermaid > svg')).toBeVisible()
})

test('the command opens the viewer from the caret', async () => {
  await page.locator('.tree-row--file', { hasText: 'Diagram.md' }).click()
  await expect(page.locator('.cm-or-mermaid > svg')).toBeVisible({ timeout: 20_000 })
  // Click the diagram to reveal its source and land the caret inside the fence.
  await page.locator('.cm-or-mermaid').click()
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', {
      commandId: 'view.expandMedia'
    })
  })
  await expect(page.locator('.media-viewer__frame')).toBeVisible({ timeout: 10_000 })
  await page.keyboard.press('Escape')
})
