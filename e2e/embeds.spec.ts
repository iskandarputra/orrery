import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'
import { makePng } from '../src/main/services/__fixtures__/make-png'

/** A one-pixel GIF89a — enough to prove an animated format loads at all. */
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

let app: ElectronApplication
let page: Page
let vault: string

async function runCommand(commandId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-embed-'))
  writeFileSync(
    join(vault, 'Source.md'),
    '# Source\n\nintro text\n\n## Alpha\n\nthe alpha body\n\n## Beta\n\nthe beta body\n'
  )
  writeFileSync(
    join(vault, 'Host.md'),
    'Before the embed.\n\n![[Source]]\n\nBetween them.\n\n![[Source#Beta]]\n\n![[Nowhere]]\n\nAnd an inline ![[Source]] mid-sentence.\n'
  )
  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'Host.md')
  await page.locator('.tree-row--file', { hasText: 'Host.md' }).click()
  await runCommand('view.modeReading')
  await page.waitForSelector('.cm-or-embed')
})

/**
 * The host editor's content. Embed cards render the note inside a nested
 * editor of their own, so a bare `.cm-content` matches those too.
 */
function hostContent() {
  return page.locator('.cm-content').first()
}

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('embeds the whole note', async () => {
  const whole = page.locator('.cm-or-embed').first()
  await expect(whole).toContainText('intro text')
  await expect(whole).toContainText('the alpha body')
})

test('an embedded note is not announced as a second text box', async () => {
  const roles = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.cm-content')).map((el) => ({
      role: el.getAttribute('role'),
      inEmbed: !!el.closest('.cm-or-embed')
    }))
  )

  // Embeds mount a CodeMirror view of their own, and CodeMirror marks its
  // content as a textbox. Nested inside the host editor's textbox that is
  // invalid ARIA, and a note with two embeds would announce as three text
  // boxes rather than one document.
  expect(roles.filter((r) => r.inEmbed).length).toBeGreaterThan(0)
  expect(roles.filter((r) => !r.inEmbed && r.role === 'textbox')).toHaveLength(1)
  for (const entry of roles.filter((r) => r.inEmbed)) expect(entry.role).toBe('article')
})

test('embeds a single section when given a heading', async () => {
  // Match on the card's own title, not on its text: the whole-note card also
  // contains the word "Beta", as one of the headings it embeds.
  const section = page
    .locator('.cm-or-embed')
    .filter({ has: page.locator('.cm-or-embed-title', { hasText: '› Beta' }) })
  await expect(section).toContainText('the beta body')
  // Only that section — the sibling's body is not dragged along.
  await expect(section).not.toContainText('the alpha body')
})

test('says so when the target does not exist', async () => {
  const missing = page.locator('.cm-or-embed--missing')
  await expect(missing).toBeVisible()
  await expect(missing).toContainText("doesn't exist yet")
})

test('leaves an embed inside a sentence as text', async () => {
  // A card there would tear the paragraph in half.
  await expect(hostContent()).toContainText('And an inline')
  const cards = await page.locator('.cm-or-embed').count()
  expect(cards).toBe(3) // whole, section, missing — not the inline one
})

test('clicking a card reveals the markdown that produced it', async () => {
  await runCommand('view.modeHybrid')
  await expect(hostContent()).toHaveAttribute('contenteditable', 'true')

  // A block widget can't be arrowed into — CodeMirror steps over it — so the
  // card takes a click and puts the caret on its source, as images and
  // diagrams do here.
  await page.locator('.cm-or-embed').first().click()
  await expect(hostContent()).toContainText('![[Source]]')

  await runCommand('view.modeReading')
})

test('a picture embedded by name is found wherever it lives in the vault', async () => {
  // `![[diagram.png]]` is how a knowledge base writes an image, and it used to
  // be answered with "doesn't exist yet": the embed only looked in the note
  // index, which is markdown matched by stem — so a picture was never found,
  // and had it been it would have been read as text and rendered as markdown.
  const pics = mkdtempSync(join(tmpdir(), 'orrery-embed-img-'))
  mkdirSync(join(pics, 'notes'), { recursive: true })
  mkdirSync(join(pics, 'assets'), { recursive: true })
  writeFileSync(join(pics, 'assets', 'diagram.png'), makePng(90, 40))
  writeFileSync(join(pics, 'assets', 'loop.gif'), GIF)
  writeFileSync(join(pics, 'Start.md'), '# Start\n')
  // The note is in one folder and the pictures in another, which is the whole
  // point of naming a file rather than pointing at it.
  writeFileSync(
    join(pics, 'notes', 'Gallery.md'),
    '# Gallery\n\n![[diagram.png]]\n\n![[loop.gif]]\n\n![[missing.png]]\n'
  )

  await openVault(page, pics, 'Start.md')
  await page.locator('.tree-row--dir', { hasText: 'notes' }).first().click()
  await page.locator('.tree-row--file', { hasText: 'Gallery.md' }).click()
  await expect(page.locator('.cm-or-embed--image img')).toHaveCount(2, { timeout: 20_000 })

  // Actually drawn, not merely an <img> with a src that resolves to nothing.
  const sizes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.cm-or-embed--image img')).map(
      (img) =>
        `${(img as HTMLImageElement).naturalWidth}x${(img as HTMLImageElement).naturalHeight}`
    )
  )
  expect(sizes).toContain('90x40')
  // The GIF too, which is a picture like any other.
  expect(sizes.filter((s) => s !== '0x0')).toHaveLength(2)

  // And one that really is absent still says so.
  await expect(page.locator('.cm-or-embed--missing')).toContainText('missing.png', {
    timeout: 10_000
  })

  rmSync(pics, { recursive: true, force: true })
})
