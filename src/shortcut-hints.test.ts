// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { shortcutLabel } from '@core/shortcut-label'
import { DEFAULT_SHORTCUTS } from '@shared/keybindings'

/**
 * No visible text names a command's key by hand.
 *
 * Hints written as text drifted from the keys that actually ran: "Bold
 * (Ctrl+B)" on the ribbon while Ctrl+B toggled the sidebar, "Ctrl+P" on a
 * button that opened what Ctrl+Shift+P opens. Every hint now comes from
 * `useShortcut`, and this fails on any source text, outside comments, that
 * spells out a key the shortcut table owns. Keys the table does not own, such
 * as undo or Ctrl+Enter in a form, belong to the editor or the widget and are
 * left alone.
 */

const ROOT = join(__dirname, 'renderer/src')

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return sources(full)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : []
  })
}

/** Block and line comments out; a hint in a comment is documentation, not UI. */
function withoutComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')
}

/** What a hard-coded Linux or Windows hint for each table key looks like. */
const OWNED = new Set(Object.values(DEFAULT_SHORTCUTS).map((key) => shortcutLabel(key, false)))

/** `Ctrl+Shift+P`, `Ctrl+,`, `Ctrl++` and the like, whole. */
const HINT = /\bCtrl(?:\+(?:Shift|Alt|\+|[^\s+'"`)}<]+))+/g

function ownedHints(code: string): string[] {
  return (
    [...withoutComments(code).matchAll(HINT)]
      // A hint that ends a sentence carries its full stop. A comma is left on,
      // because Ctrl+, is a key of its own.
      .map((m) => (OWNED.has(m[0]) ? m[0] : m[0].replace(/[.;:!?]$/, '')))
      .filter((hint) => OWNED.has(hint))
  )
}

describe('shortcut hints', () => {
  it('finds a hard-coded hint when there is one, so the check below can fail', () => {
    expect(ownedHints(`<button title="Bold (Ctrl+B)" />`)).toEqual(['Ctrl+B'])
    expect(ownedHints(`label: 'Command palette (Ctrl+Shift+P)'`)).toEqual(['Ctrl+Shift+P'])
    expect(ownedHints(`<p>Open the chat with Ctrl+Shift+A.</p>`)).toEqual(['Ctrl+Shift+A'])
  })

  it('leaves comments and keys the table does not own alone', () => {
    expect(ownedHints(`// Ctrl+B toggles the sidebar`)).toEqual([])
    expect(ownedHints(`/* Ctrl+S saves */`)).toEqual([])
    expect(ownedHints(`title="Undo (Ctrl+Z)"`)).toEqual([])
    expect(ownedHints(`<span>Ctrl+Enter runs it.</span>`)).toEqual([])
  })

  it('does not take Ctrl+S out of Ctrl+Shift+Z', () => {
    expect(ownedHints(`title="Redo (Ctrl+Shift+Z)"`)).toEqual([])
  })

  it('appear nowhere in the renderer as text', () => {
    const found = sources(ROOT).flatMap((file) =>
      ownedHints(readFileSync(file, 'utf-8')).map((hint) => `${relative(ROOT, file)}: ${hint}`)
    )
    expect(found).toEqual([])
  })
})
