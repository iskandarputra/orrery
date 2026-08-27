import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  test,
  expect,
  type ElectronApplication,
  type Page
} from '@playwright/test'
import { closeCleanly, launchApp, openVault } from './helpers'

let app: ElectronApplication
let page: Page
let vault: string

/** Today, formatted the way the app's default `YYYY-MM-DD` does. */
function today(): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

async function runCommand(commandId: string): Promise<void> {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, commandId)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-notes-'))
  mkdirSync(join(vault, 'Templates'), { recursive: true })
  writeFileSync(
    join(vault, 'Templates', 'Daily.md'),
    '# {{date:dddd D MMMM YYYY}}\n\n## Log\n\n{{cursor}}\n\n## Tomorrow\n\n- [[{{date+1d}}]]\n'
  )
  writeFileSync(join(vault, 'Templates', 'Meeting.md'), '## Meeting — {{date}}\n\nAttendees: \n')
  writeFileSync(join(vault, 'Scratch.md'), '# Scratch\n\n')

  app = await launchApp()
  page = await app.firstWindow()
  await page.waitForSelector('.app', { timeout: 30_000 })
  // Daily notes and templates are configured per-vault; openVault reloads, so
  // these have to be in settings before it runs.
  await page.evaluate(
    async (v) =>
      window.orrery.invoke('settings:set', {
        lastOpenedFolder: v,
        session: { openPaths: [], activePath: '' },
        dailyNotes: { folder: 'Daily', format: 'YYYY-MM-DD', template: 'Templates/Daily.md' },
        templates: { folder: 'Templates' }
      }),
    vault
  )
  await openVault(page, vault, 'Scratch.md')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test("creates today's note from the template, folder and all", async () => {
  const target = join(vault, 'Daily', `${today()}.md`)
  expect(existsSync(target)).toBe(false)

  await runCommand('note.openToday')
  await expect(page.locator('.tab--active .tab__label')).toHaveText(`${today()}.md`)

  const written = readFileSync(target, 'utf-8')
  // Placeholders are resolved, not left in the file.
  expect(written).not.toContain('{{')
  expect(written).toContain('## Log')
  // The date heading and tomorrow's link both rendered.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
  const pad = (n: number): string => String(n).padStart(2, '0')
  expect(written).toContain(
    `[[${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}]]`
  )
})

test('opening it again never overwrites what you wrote', async () => {
  const target = join(vault, 'Daily', `${today()}.md`)
  writeFileSync(target, 'edited by hand\n')

  await runCommand('note.openToday')
  await expect(page.locator('.tab--active .tab__label')).toHaveText(`${today()}.md`)
  expect(readFileSync(target, 'utf-8')).toBe('edited by hand\n')
})

test('the template picker inserts a rendered template at the cursor', async () => {
  await runCommand('app.quickOpen')
  await page.locator('.palette__input').fill('scratch')
  await page.keyboard.press('Enter')
  await expect(page.locator('.tab--active .tab__label')).toHaveText('Scratch.md')

  await page.locator('.cm-content').click()
  await page.keyboard.press('Control+End')

  await runCommand('note.insertTemplate')
  await expect(page.locator('.palette')).toBeVisible()
  // The picker lists the template folder, not the whole vault.
  await expect(page.locator('.palette__item', { hasText: 'Scratch' })).toHaveCount(0)
  await page.locator('.palette__input').fill('meeting')
  await page.keyboard.press('Enter')

  await expect(page.locator('.cm-content')).toContainText('Meeting —')
  await expect(page.locator('.cm-content')).not.toContainText('{{')
})
