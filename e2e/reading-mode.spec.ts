import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * Reading mode, which nothing else in this suite ever entered.
 *
 * `openVault` sets the view mode to live for every other spec, and the two
 * userData directories on a developer's machine happened to be in live and
 * source mode. So reading mode shipped with a crash in it: a comment written
 * across several lines was concealed in one span, CodeMirror refused a
 * replacing decoration that crosses a line break from a view plugin, the
 * pane's React tree unmounted, and the window went blank with nothing on
 * screen to say why.
 *
 * The assertion is the whole window, not the comment: a crash here takes the
 * app with it, so "is anything still on screen" is the question worth asking.
 */
let app: ElectronApplication
let page: Page
let vault: string
const errors: string[] = []

const VAULT: Record<string, string> = {
  'Commented.md': `<!--
  written across
  several lines
-->

# Commented

Body text under a comment that spans lines.
`,
  'Plain.md': '# Plain\n\nNothing unusual here.\n'
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-reading-'))
  for (const [name, content] of Object.entries(VAULT)) {
    writeFileSync(join(vault, name), content)
  }
  app = await launchApp()
  page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(e.message))
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Plain.md')
  // After openVault, which forces live mode for every other spec.
  await page.evaluate(async () => {
    const current = await window.orrery.invoke('settings:get', undefined)
    await window.orrery.invoke('settings:set', {
      editor: { ...current.editor, viewMode: 'reading' }
    })
  })
})

test.afterAll(async () => {
  await closeCleanly(app, page)
})

test('a comment spanning lines does not take the window down in reading mode', async () => {
  await page.locator('.tree-row--file', { hasText: 'Commented.md' }).click()
  await expect(page.locator('.cm-content')).toContainText('Body text under a comment')

  // Still there, which is the point: the crash unmounted everything.
  await expect(page.locator('.app')).toBeVisible()
  expect(errors.filter((e) => /replace line breaks|Decorations/.test(e))).toEqual([])

  // And the comment is hidden rather than shown as raw markup.
  await expect(page.locator('.cm-content')).not.toContainText('written across')
})
