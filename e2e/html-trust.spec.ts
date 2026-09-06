import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { launchApp, openVault } from './helpers'

/**
 * Consent to run a page's own code, and how long it lasts.
 *
 * It used to last as long as the tab. That made the offer honest and made it
 * tiring: a page you keep coming back to asked every time, and a question asked
 * that often stops being read, which is the failure mode a permission prompt
 * has. So it is remembered against the file.
 *
 * The whole of the risk in remembering it is that a path is a name, not a
 * document. `report.html` can be replaced by a sync client, a second download
 * or a `git pull`, and the consent would carry across to a page nobody has
 * looked at. So an entry names the bytes as well, and the case below where the
 * file is rewritten while the app is shut is the one that matters most here.
 *
 * The app is genuinely stopped and started again, on the same application data,
 * because that is the only thing that proves what survives a quit.
 */

/** Says out loud whether its own script ran, with `filler` to change the bytes. */
const PAGE = (filler: string): string => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Trusted</title></head><body>
<h1>Trusted</h1>
<p>${filler}</p>
<p id="ran">scripts did not run</p>
<script>document.getElementById('ran').textContent = 'SCRIPTS RAN'</script>
</body></html>
`

let vault: string
let userData: string
let app: ElectronApplication
let page: Page

const rendered = (): ReturnType<Page['frameLocator']> => page.frameLocator('.htmlv__frame')
const offer = (): ReturnType<Page['locator']> =>
  page.locator('.htmlv__action', { hasText: /Run \d+ scripts?/ })
const running = (): ReturnType<Page['locator']> =>
  page.locator('.htmlv__action', { hasText: /scripts? running/ })

const start = async (): Promise<void> => {
  app = await launchApp({ userData })
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1200, height: 800 })
  await page.waitForSelector('.app', { timeout: 30_000 })
}

/** Open `page.html` and switch it to Read, from wherever the app came up. */
const openAndRead = async (): Promise<void> => {
  await page.locator('.tree-row--file', { hasText: 'page.html' }).click()
  await expect(page.locator('.tab', { hasText: 'page.html' })).toBeVisible({ timeout: 20_000 })
  await page.locator('.header-viewmode__btn', { hasText: 'Read' }).click()
  await expect(page.locator('.htmlv__frame')).toBeVisible({ timeout: 15_000 })
  await expect(rendered().locator('h1')).toHaveText('Trusted', { timeout: 20_000 })
}

/**
 * Settings are written debounced and flushed on quit, so a consent given in the
 * last instant before `app.close()` needs the moment it takes to reach disk.
 */
const settle = async (): Promise<void> => {
  await page.waitForTimeout(700)
}

test.beforeAll(() => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-htmltrust-'))
  userData = mkdtempSync(join(tmpdir(), 'orrery-htmltrust-ud-'))
  writeFileSync(join(vault, 'page.html'), PAGE('the first version'))
  writeFileSync(join(vault, 'Note.md'), '# Note\n')
})

test.afterAll(() => {
  rmSync(vault, { recursive: true, force: true })
  rmSync(userData, { recursive: true, force: true })
})

test('asks the first time, and runs the page when asked', async () => {
  await start()
  await openVault(page, vault, 'Note.md')
  await openAndRead()

  await expect(offer()).toBeVisible()
  await expect(rendered().locator('#ran')).toHaveText('scripts did not run')

  await offer().click()
  await expect(running()).toBeVisible({ timeout: 20_000 })
  await expect(rendered().locator('#ran')).toHaveText('SCRIPTS RAN', { timeout: 20_000 })

  await settle()
  await app.close()
})

test('does not ask again once the app has been restarted', async () => {
  // The point of the change. Nothing is pressed here: the page is opened, read,
  // and it runs.
  await start()
  await openAndRead()

  await expect(running()).toBeVisible({ timeout: 20_000 })
  await expect(offer()).toHaveCount(0)
  await expect(rendered().locator('#ran')).toHaveText('SCRIPTS RAN', { timeout: 20_000 })

  await app.close()
})

test('asks again when the file was changed while it was shut', async () => {
  // The reason an entry carries a digest and not just a path. Same name, same
  // folder, different document, and a consent given about the other one.
  writeFileSync(join(vault, 'page.html'), PAGE('a different version, from somewhere else'))

  await start()
  await openAndRead()

  await expect(offer()).toBeVisible({ timeout: 20_000 })
  await expect(rendered().locator('#ran')).toHaveText('scripts did not run')
  // And it stays that way: a page that is merely slow to run would pass the
  // line above and fail this one.
  await page.waitForTimeout(800)
  await expect(rendered().locator('#ran')).toHaveText('scripts did not run')

  await app.close()
})

test('stopping it takes the consent back, here and for next time', async () => {
  await start()
  await openAndRead()

  await offer().click()
  await expect(running()).toBeVisible({ timeout: 20_000 })
  await expect(rendered().locator('#ran')).toHaveText('SCRIPTS RAN', { timeout: 20_000 })

  // The notice is the way back. Pressing it rebuilds the page without the
  // page's code, which is what makes the marker readable again.
  await running().click()
  await expect(offer()).toBeVisible({ timeout: 20_000 })
  await expect(rendered().locator('#ran')).toHaveText('scripts did not run', { timeout: 20_000 })

  await settle()
  await app.close()

  await start()
  await openAndRead()
  await expect(offer()).toBeVisible({ timeout: 20_000 })
  await expect(rendered().locator('#ran')).toHaveText('scripts did not run')
  await app.close()
})
