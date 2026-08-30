import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * Raw HTML in a note.
 *
 * The fixture is the block every README opens with, because that is the case
 * that sent someone looking for this: a centred title, a line of badges, and a
 * fold. Beside it, the markup a note must never be allowed to run.
 */

let app: ElectronApplication
let page: Page
let vault: string

const DOC = `<h1 align="center">Orrery</h1>

<p align="center">
  A desktop markdown editor and knowledge base.
</p>

<p align="center">
  <a href="LICENSE"><img alt="MIT licence" src="https://img.shields.io/badge/licence-MIT-blue.svg"></a>
  <img alt="Electron" src="https://img.shields.io/badge/Electron-43-47848F.svg">
</p>

Ordinary prose between the blocks.

<details>
<summary>Fold me</summary>

Hidden until asked for.

</details>

<div>
  <script>window.__ran = true</script>
  <img src="x.png" onerror="window.__ran = true">
  <iframe src="https://example.com"></iframe>
  <a href="javascript:window.__ran = true">not a link</a>
</div>

Tail.
`

async function runCommand(commandId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

const blocks = (): ReturnType<Page['locator']> => page.locator('.cm-or-html-block')

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-html-'))
  writeFileSync(join(vault, 'Readme.md'), DOC)
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Readme.md')
  await page.locator('.tree-row--file', { hasText: 'Readme.md' }).click()
  await page.waitForSelector('.cm-content')
  await runCommand('view.modeReading')
  await expect(blocks().first()).toBeVisible({ timeout: 15_000 })
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('the header block renders as a heading, centred, with its badges', async () => {
  const heading = page.locator('.cm-or-html-block h1')
  await expect(heading).toHaveText('Orrery')
  await expect(heading).toHaveAttribute('align', 'center')
  // Actually centred on screen, not merely carrying the attribute.
  const centred = await heading.evaluate((el) => getComputedStyle(el).textAlign)
  expect(centred).toBe('center')

  // Both badges, and only them: the img elsewhere in the fixture is kept too,
  // stripped of the handler that made it dangerous.
  const badges = page.locator('.cm-or-html-block img[src*="img.shields.io"]')
  await expect(badges).toHaveCount(2)
  await expect(badges.first()).toHaveAttribute('alt', 'MIT licence')
})

test('the source is not shown as text once it is rendered', async () => {
  const text = (await page.locator('.cm-content').textContent()) ?? ''
  expect(text).not.toContain('<h1 align=')
  expect(text).toContain('Ordinary prose between the blocks.')
})

test('a details block folds and unfolds', async () => {
  const details = page.locator('.cm-or-html-block details')
  await expect(details).toHaveCount(1)
  expect(await details.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false)
  await page.locator('.cm-or-html-block summary').click()
  expect(await details.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true)
})

test('nothing in the note ran, and nothing was loaded that could', async () => {
  // The whole reason the renderer is an allow-list.
  expect(
    await page.evaluate(() => (window as unknown as { __ran?: boolean }).__ran)
  ).toBeUndefined()
  await expect(page.locator('.cm-or-html-block iframe')).toHaveCount(0)
  await expect(page.locator('.cm-or-html-block script')).toHaveCount(0)
  const hrefs = await page
    .locator('.cm-or-html-block a')
    .evaluateAll((els) => els.map((el) => el.getAttribute('href') ?? ''))
  expect(hrefs.some((href) => href.startsWith('javascript:'))).toBe(false)
})

test('it says what it refused to render', async () => {
  await expect(page.locator('.cm-or-html-block__note')).toContainText('<iframe>')
  await expect(page.locator('.cm-or-html-block__note')).toContainText('<script>')
})

test('an outgoing link opens outside the app', async () => {
  const link = page.locator('.cm-or-html-block a').first()
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('rel', 'noreferrer noopener')
})

test('hybrid renders it too, and gives the source back at the cursor', async () => {
  await runCommand('view.modeHybrid')
  await expect(blocks().first()).toBeVisible({ timeout: 15_000 })

  // Put the cursor inside the first block: it becomes editable text again.
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+Home')
  await expect(page.locator('.cm-content')).toContainText('<h1 align=', { timeout: 10_000 })

  // And away again: rendered.
  await page.keyboard.press('Control+End')
  await expect(page.locator('.cm-content')).not.toContainText('<h1 align=', { timeout: 10_000 })
})
