import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, type Page } from '@playwright/test'
import type { ElectronApplication } from 'playwright'
import { closeCleanly, launchApp, openVault } from './helpers'

/**
 * Goto Anything: one box where a prefix decides what is searched.
 *
 * `:` for a line and `@` for a symbol, both scoped to the document in front of
 * you. The palette could already find files and commands; it could not find
 * anything *inside* the thing you were looking at.
 */

const CODE = [
  'import { readFile } from "node:fs"', // 1
  '', // 2
  'export function parse(input: string): number {', // 3
  '  if (input === "") {', // 4
  '    return 0', // 5
  '  }', // 6
  '  return input.length', // 7
  '}', // 8
  '', // 9
  'export class Lexer {', // 10
  '  run() {', // 11
  '    return parse("x")', // 12
  '  }', // 13
  '}' // 14
].join('\n')

const NOTE = '# Title\n\nProse.\n\n## Background\n\n```sh\n# not a heading\n```\n\n## Method\n'

let app: ElectronApplication
let page: Page
let vault: string

/**
 * Open the palette and set its query.
 *
 * The query is filled rather than typed: the input takes focus in an effect, so
 * keystrokes sent the instant it becomes visible can land in the editor behind
 * it and the test then measures something else entirely.
 */
const openPalette = async (mode: string, query: string): Promise<void> => {
  await app.evaluate(({ BrowserWindow }, id) => {
    BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', { commandId: id })
  }, mode)
  await expect(page.locator('.palette')).toBeVisible({ timeout: 10_000 })
  const input = page.locator('.palette input')
  await expect(input).toBeFocused()
  await input.fill(query)
}

/** The caret's line, polled: the status bar's stats are updated off a throttle,
    so reading it the instant after a jump samples the value before the move. */
const expectCaretLine = async (line: number): Promise<void> => {
  await expect
    .poll(
      async () => {
        const text = await page.locator('.status-bar').textContent()
        return Number(/Ln (\d+)/.exec(text ?? '')?.[1] ?? 0)
      },
      { timeout: 5000 }
    )
    .toBe(line)
}

test.beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), 'orrery-goto-'))
  writeFileSync(join(vault, 'lexer.ts'), CODE)
  writeFileSync(join(vault, 'Note.md'), NOTE)
  app = await launchApp()
  page = await app.firstWindow()
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.waitForSelector('.app', { timeout: 30_000 })
  await openVault(page, vault, 'lexer.ts')
})

test.afterAll(async () => {
  await closeCleanly(app, page)
  rmSync(vault, { recursive: true, force: true })
})

test('a colon jumps to a line, and puts the caret there', async () => {
  await page.locator('.tree-row--file', { hasText: 'lexer.ts' }).click()
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 15_000 })

  await openPalette('go.toLine', ':7')
  await expect(page.locator('.palette__item').first()).toContainText('Line 7')
  // The line's own text, so the target is confirmed before committing to it.
  await expect(page.locator('.palette__item').first()).toContainText('return input.length')
  await page.keyboard.press('Enter')

  // Scrolling there is not enough: the caret has to move, or the next keystroke
  // types somewhere else entirely.
  await expectCaretLine(7)
})

test('jumping does not type into the document', async () => {
  // The palette commits on Enter and the jump focuses the editor, so an Enter
  // that is not consumed arrives in the document as a newline — a navigation
  // that silently edits the file it navigates.
  const before = await page.locator('.cm-content .cm-line').count()
  await openPalette('go.toLine', ':5')
  await page.keyboard.press('Enter')
  await expectCaretLine(5)
  expect(await page.locator('.cm-content .cm-line').count()).toBe(before)
  await expect(page.locator('.tab--active .tab__dirty-dot')).toHaveCount(0)
})

test('a line past the end goes to the end rather than refusing', async () => {
  await openPalette('go.toLine', ':9999')
  await page.keyboard.press('Enter')
  await expectCaretLine(14)
})

test('an at-sign lists the declarations of a code file', async () => {
  await openPalette('go.toSymbol', '@')
  const items = page.locator('.palette__item')
  await expect(items).toHaveCount(3)
  await expect(items.nth(0)).toContainText('parse')
  await expect(items.nth(1)).toContainText('Lexer')
  await expect(items.nth(2)).toContainText('run')
  // `if (input === "") {` has the exact shape of a method declaration.
  await expect(page.locator('.palette')).not.toContainText('if')
})

test('a symbol can be filtered, and jumping lands on it', async () => {
  await openPalette('go.toSymbol', '@Lex')
  await expect(page.locator('.palette__item')).toHaveCount(1)
  await page.keyboard.press('Enter')
  await expectCaretLine(10)
})

test('in a note it lists headings, and not the ones inside a fence', async () => {
  await page.locator('.tree-row--file', { hasText: 'Note.md' }).click()
  await expect(page.locator('.cm-content')).toBeVisible({ timeout: 15_000 })

  await openPalette('go.toSymbol', '@')
  const items = page.locator('.palette__item')
  await expect(items).toHaveCount(3)
  await expect(items.nth(0)).toContainText('Title')
  await expect(items.nth(2)).toContainText('Method')
  // A shell comment in a fenced block is not a heading.
  await expect(page.locator('.palette')).not.toContainText('not a heading')
})
