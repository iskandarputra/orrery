import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, test, expect } from '@playwright/test'
import { LAUNCH_ARGS, launchEnv } from './helpers'
import { makePdf } from '../src/main/services/__fixtures__/make-pdf'

/**
 * Proves the PDF engines are still there in a *packaged* layout.
 *
 * Packaging leaves out what the app does not load at runtime — nearly sixty
 * megabytes of engine that is already copied beside `index.html` — and getting
 * that wrong breaks nothing in development and everything in the installer.
 * Only running the packaged build exercises it.
 */
const PACKAGED = resolve('dist/linux-unpacked/orrery')

test.skip(!existsSync(PACKAGED), 'no packaged build in dist/linux-unpacked')

test('the packaged app reads, recognises and rearranges a PDF', async () => {
  const vault = mkdtempSync(join(tmpdir(), 'orrery-pkgpdf-'))
  const paper = join(vault, 'Paper.pdf')
  writeFileSync(join(vault, 'Index.md'), '# Index\n')
  writeFileSync(paper, makePdf({ pages: [['Packaged page one.'], ['Packaged page two.'], []] }))
  const userData = mkdtempSync(join(tmpdir(), 'orrery-pkgpdf-ud-'))

  const app = await electron.launch({
    executablePath: PACKAGED,
    args: [...LAUNCH_ARGS, `--user-data-dir=${userData}`],
    env: launchEnv()
  })
  const page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  await page.evaluate(async (v) => {
    await window.orrery.invoke('settings:set', {
      lastOpenedFolder: v,
      session: { openPaths: [], activePath: '' }
    })
  }, vault)
  await page.reload()
  await page.waitForSelector('.app', { timeout: 30_000 })

  // Reading: the engine and its character maps came through.
  await page.locator('.tree-row--file', { hasText: 'Paper.pdf' }).click()
  await expect(page.locator('.pdfViewer .textLayer').first()).toContainText('Packaged page one.', {
    timeout: 30_000
  })

  // Recognising: the OCR worker, its wasm engine and the English data are all
  // beside index.html rather than fetched from a CDN this app cannot reach.
  const offer = page.locator('button[aria-label="Recognise the text on scanned pages"]')
  await expect(offer).toBeVisible({ timeout: 30_000 })
  await offer.click()
  await expect(page.locator('.toast__message')).toContainText(/Recognised|Nothing legible/, {
    timeout: 120_000
  })

  // Rearranging: PDFium's wasm is read out of the packaged node_modules.
  await page.locator('.pdfv__tab', { hasText: 'Pages' }).click()
  await page.locator('.pdfv__thumb').first().click()
  await page.locator('button[aria-label="Remove pages"]').click()
  await page.locator('.pdfv__page-pending button', { hasText: 'Apply' }).click()
  await expect(page.locator('.pdfv__count')).toHaveText('of 2', { timeout: 60_000 })
  expect(readFileSync(paper).length).toBeGreaterThan(0)

  await app.close()
  rmSync(vault, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})
