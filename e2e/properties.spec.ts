import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * The properties card, editable in place.
 *
 * The requirement that matters is fidelity: changing one property must leave
 * every other byte alone, or every note in the vault churns the first time it
 * is opened.
 */

const NOTE = [
  '---',
  'title: Orbital mechanics',
  'tags:',
  '  - research',
  '  - draft',
  'status: in-progress',
  "quoted: 'left alone'",
  '---',
  '',
  '# Orbital mechanics',
  '',
  'Body text.',
  ''
].join('\n')

let app: ElectronApplication
let page: Page
let vault: string

const file = (): string => join(vault, 'Note.md')
const read = (): string => readFileSync(file(), 'utf-8')

const save = async (): Promise<void> => {
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: 'file.save' })
  })
  await page.waitForTimeout(900)
}

const open = async (): Promise<void> => {
  await page.locator('.tree-row--file', { hasText: 'Other.md' }).click()
  await page.waitForTimeout(300)
  await page.locator('.tree-row--file', { hasText: 'Note.md' }).click()
  await expect(page.locator('.cm-or-properties-card')).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(400)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-props-'))
  writeFileSync(file(), NOTE)
  writeFileSync(join(vault, 'Other.md'), '# Other\n')
  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1300, height: 860 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Note.md')
})

test.afterAll(async () => {
  // The view mode is a persisted setting shared by every spec, so leaving it on
  // source would break whichever suite ran next. Restored even if a test above
  // failed before its own restore.
  await page
    .getByRole('radio', { name: 'Hybrid' })
    .click()
    .catch(() => undefined)
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('the card shows every property, lists included', async () => {
  await open()
  await expect(page.locator('.cm-or-property-row')).toHaveCount(4)
  await expect(page.getByLabel('Value of title')).toHaveValue('Orbital mechanics')
  // A list is edited as the comma-separated line a person would write.
  await expect(page.getByLabel('Value of tags')).toHaveValue('research, draft')
})

test('editing a value writes it back, leaving the rest byte for byte', async () => {
  await open()
  await page.getByLabel('Value of status').fill('done')
  await page.getByLabel('Value of status').blur()
  await save()

  const written = read()
  expect(written).toContain('status: done')
  // Everything else exactly as it was, quoting and indentation included.
  expect(written).toContain("quoted: 'left alone'")
  expect(written).toContain('tags:\n  - research\n  - draft')
  expect(written).toContain('title: Orbital mechanics')
  expect(written).toContain('\n# Orbital mechanics\n\nBody text.\n')
})

test('editing a list writes it back as block items', async () => {
  await open()
  await page.getByLabel('Value of tags').fill('research, urgent, new')
  await page.getByLabel('Value of tags').blur()
  await save()
  expect(read()).toContain('tags:\n  - research\n  - urgent\n  - new')
})

test('a property can be renamed without moving', async () => {
  await open()
  await page.getByLabel('Name of property status').fill('state')
  await page.getByLabel('Name of property status').blur()
  await save()
  const keys = read()
    .split('---')[1]!
    .split('\n')
    .filter((l) => /^\w/.test(l))
    .map((l) => l.split(':')[0])
  expect(keys).toEqual(['title', 'tags', 'state', 'quoted'])
})

test('a property can be added and removed', async () => {
  await open()
  await page.locator('.cm-or-property-add').click()
  await save()
  expect(read()).toContain('property:')

  await open()
  await page.getByLabel('Remove property property').click()
  await save()
  expect(read()).not.toContain('property:')
})

test('the card is shown from the moment the note opens', async () => {
  // Unlike every other live-preview block, this one is not revealed by cursor
  // position: it begins at offset zero, which is where the caret rests on any
  // freshly opened document, so a position test showed raw YAML every time.
  await open()
  await expect(page.locator('.cm-or-properties-card')).toBeVisible()
  await page.keyboard.press('Control+Home')
  await expect(page.locator('.cm-or-properties-card')).toBeVisible()
})

test('source mode is where the raw YAML lives', async () => {
  // The card is the editor for properties; source mode is the way out when a
  // block is malformed enough that the card cannot show it.
  // Through the switch in the header, which is how anyone actually changes it.
  const mode = async (label: string): Promise<void> => {
    await page.getByRole('radio', { name: label }).click()
    await page.waitForTimeout(700)
  }

  await open()
  await mode('Edit')
  await expect(page.locator('.cm-or-properties-card')).toHaveCount(0)
  await expect(page.locator('.cm-content').first()).toContainText('title: Orbital mechanics')
  await mode('Hybrid')
})

test('a note with no frontmatter shows no card', async () => {
  await page.locator('.tree-row--file', { hasText: 'Other.md' }).click()
  await expect(page.locator('.cm-content').first()).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('.cm-or-properties-card')).toHaveCount(0)
})
