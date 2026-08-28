import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string
let binDir: string
let originalPath: string | undefined

const SOURCE = ['const fine = 1', 'const BAD = 2', 'const alsoFine = 3'].join('\n') + '\n'

async function open(file: string): Promise<void> {
  await page.locator('.tree-row--file', { hasText: file }).click()
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 15_000 })
}

/** The messages CodeMirror is currently showing for this document. */
async function diagnostics(): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.cm-lintRange-error, .cm-lintRange-warning')).map(
      (el) => el.textContent ?? ''
    )
  )
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-lsp-'))
  writeFileSync(join(vault, 'Note.md'), '# Note\n\nProse.\n')
  writeFileSync(join(vault, 'code.ts'), SOURCE)
  writeFileSync(join(vault, 'target.ts'), 'export const definedHere = 1\n')

  // A stand-in for typescript-language-server, put on PATH ahead of any real
  // one. The client cannot tell the difference, which is the point: the test
  // exercises spawn, framing, handshake, sync and publish for real, and needs
  // nothing installed on the machine running it.
  binDir = mkdtempSync(join(tmpdir(), 'orrery-lsp-bin-'))
  const stub = resolve('e2e/fixtures/stub-language-server.mjs')
  const shim = join(binDir, 'typescript-language-server')
  writeFileSync(shim, `#!/bin/sh\nexec node ${JSON.stringify(stub)} "$@"\n`)
  chmodSync(shim, 0o755)
  originalPath = process.env['PATH']
  process.env['PATH'] = `${binDir}:${originalPath ?? ''}`

  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1300, height: 850 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'code.ts')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  if (originalPath !== undefined) process.env['PATH'] = originalPath
  rmSync(vault, { recursive: true, force: true })
  rmSync(binDir, { recursive: true, force: true })
})

/**
 * The whole pipe in one assertion: main spawns the server, frames the
 * handshake, syncs the document, decodes what comes back, routes it to the
 * right buffer, and the editor draws it.
 */
test('a server diagnostic reaches the editor', async () => {
  await open('code.ts')
  await expect
    .poll(async () => (await diagnostics()).length, { timeout: 20_000 })
    .toBeGreaterThan(0)
  // Underlining the offending token, not the whole line.
  expect((await diagnostics())[0]).toBe('BAD')
})

test('editing the document updates what the server says', async () => {
  await open('code.ts')
  await expect.poll(async () => (await diagnostics()).length, { timeout: 20_000 }).toBe(1)

  // Add a second offence; the client re-syncs and the server re-publishes.
  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')
  await page.keyboard.type('const BAD2 = 4')

  await expect.poll(async () => (await diagnostics()).length, { timeout: 20_000 }).toBe(2)
})

test('hovering a symbol shows what the server knows about it', async () => {
  await open('code.ts')
  await expect
    .poll(async () => (await diagnostics()).length, { timeout: 20_000 })
    .toBeGreaterThan(0)

  // Hover the word "fine" on the first line.
  // CodeMirror tracks the pointer across a run of mousemove events and then
  // waits for it to settle; one jump to the target coordinate produces neither.
  const box = (await page.locator('.cm-content .cm-line').first().boundingBox())!
  await page.locator('.cm-content').click()
  await page.mouse.move(box.x + 10, box.y + box.height / 2, { steps: 5 })
  await page.mouse.move(box.x + 48, box.y + box.height / 2, { steps: 15 })

  const tip = page.locator('.cm-or-hover')
  await expect(tip).toBeVisible({ timeout: 15_000 })
  await expect(tip).toContainText('stub docs for')
})

test('go to definition jumps to the other file', async () => {
  await open('code.ts')
  await expect
    .poll(async () => (await diagnostics()).length, { timeout: 20_000 })
    .toBeGreaterThan(0)

  await page.locator('.cm-content').click()
  await page.keyboard.press('F12')

  // The definition lives in another file, so the jump has to open it first.
  await expect(page.locator('.tab--active')).toContainText('target.ts', { timeout: 15_000 })
  await expect
    .poll(() => page.evaluate(() => document.querySelector('.cm-content')?.textContent ?? ''), {
      timeout: 15_000
    })
    .toContain('definedHere')
})

test('a note never reaches a language server', async () => {
  await open('Note.md')
  // Prose has no server and no lint surface at all.
  await expect(page.locator('.cm-lintRange-error')).toHaveCount(0)
  await expect(page.locator('.cm-gutter-lint')).toHaveCount(0)
})
