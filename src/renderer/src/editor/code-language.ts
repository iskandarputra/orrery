import { Compartment } from '@codemirror/state'
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import type { EditorView } from '@codemirror/view'
import { docPathFacet } from './doc-context'

/**
 * Holds a code buffer's grammar. Empty until the grammar has loaded, because
 * `@codemirror/language-data` code-splits every language — loading them all up
 * front would mean shipping every grammar to open one JSON file.
 */
export const languageCompartment = new Compartment()

export function findLanguage(fileName: string): LanguageDescription | null {
  return LanguageDescription.matchFilename(languages, fileName)
}

/** What the status bar calls this buffer. */
export function languageLabel(fileName: string): string {
  return findLanguage(fileName)?.name ?? 'Plain Text'
}

/** Whether the compartment is still empty — i.e. no grammar installed yet. */
function unloaded(view: EditorView): boolean {
  const current = languageCompartment.get(view.state)
  return Array.isArray(current) ? current.length === 0 : current == null
}

/**
 * Load the grammar for `filePath` and install it in `view`.
 *
 * A pane is reused across tab switches, so the buffer can change while the
 * grammar is still loading; the document's own path is checked again before
 * the grammar is installed, or a slow language would land on the wrong file.
 */
export async function ensureLanguage(view: EditorView, filePath: string): Promise<void> {
  if (!unloaded(view)) return
  const desc = findLanguage(filePath)
  if (!desc) return
  const support = await desc.load()
  if (view.state.facet(docPathFacet) !== filePath || !unloaded(view)) return
  view.dispatch({ effects: languageCompartment.reconfigure(support) })
}
