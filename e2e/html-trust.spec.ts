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

/** Open a page and switch it to Read, from wherever the app came up. */
const openAndRead = async (name = 'page.html'): Promise<void> => {
  await page.locator('.tree-row--file', { hasText: name }).click()
  await expect(page.locator('.tab', { hasText: name })).toBeVisible({ timeout: 20_000 })
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

/**
 * The standing answer, set through main and picked up on a reload.
 *
 * `settings:set` changes the copy main holds; the renderer's own copy is loaded
 * at startup, so a reader already on screen would go on using the old one.
 */
const setRunScripts = async (runScripts: boolean): Promise<void> => {
  await page.evaluate(async (on) => {
    await window.orrery.invoke('settings:set', { html: { runScripts: on } })
  }, runScripts)
  await page.reload()
  await page.waitForSelector('.app', { timeout: 30_000 })
}

test.beforeAll(() => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-htmltrust-'))
  userData = mkdtempSync(join(tmpdir(), 'orrery-htmltrust-ud-'))
  writeFileSync(join(vault, 'page.html'), PAGE('the first version'))
  // Two more, so the standing setting is measured against pages that no test
  // has given a consent to. A page carrying one would run either way.
  writeFileSync(join(vault, 'auto.html'), PAGE('never consented to'))
  writeFileSync(join(vault, 'later.html'), PAGE('never consented to either'))
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

test('runs a page on sight when it is told to, and asks nothing', async () => {
  // The standing answer, for someone who has decided that opening a local page
  // means reading the page. `auto.html` has never been consented to: without
  // the setting it is the offer and a marker saying the code did not run.
  await start()
  await setRunScripts(true)
  await openAndRead('auto.html')

  await expect(running()).toBeVisible({ timeout: 20_000 })
  await expect(offer()).toHaveCount(0)
  await expect(rendered().locator('#ran')).toHaveText('SCRIPTS RAN', { timeout: 20_000 })
})

test('and stopping one still stops it', async () => {
  // The reason a stopped buffer is remembered as stopped rather than as
  // undecided. Undecided is what the setting acts on, so a Stop that merely
  // forgot would hand the page back to it on the very next rebuild.
  await running().click()
  await expect(offer()).toBeVisible({ timeout: 20_000 })
  await expect(rendered().locator('#ran')).toHaveText('scripts did not run', { timeout: 20_000 })
  await page.waitForTimeout(700)
  await expect(rendered().locator('#ran')).toHaveText('scripts did not run')
})

test('turning it off asks again, because it recorded no consent', async () => {
  // A page that ran under the setting was never vouched for, and turning the
  // setting off has to mean it. `later.html` is opened once with the setting
  // on and never pressed, so anything it is allowed afterwards came from the
  // setting having written a consent it had no business writing.
  await openAndRead('later.html')
  await expect(running()).toBeVisible({ timeout: 20_000 })

  await setRunScripts(false)
  await openAndRead('later.html')
  await expect(offer()).toBeVisible({ timeout: 20_000 })
  await expect(rendered().locator('#ran')).toHaveText('scripts did not run')

  await app.close()
})
