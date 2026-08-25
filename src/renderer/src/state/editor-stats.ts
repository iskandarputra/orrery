import { create } from 'zustand'
import type { EditorState } from '@codemirror/state'

export interface EditorStats {
  words: number
  characters: number
  /** Lines in the document. */
  lines: number
  /** Line the cursor is on (1-based) — the status bar's "Ln". */
  line: number
  /** Column the cursor is at (1-based) — the status bar's "Col". */
  column: number
}

/**
 * High-frequency editor stats live in their own tiny store so keystrokes
 * never touch the main app store.
 */
export const useEditorStats = create<EditorStats>(() => ({
  words: 0,
  characters: 0,
  lines: 1,
  line: 1,
  column: 1
}))

/** Pure over the editor state, so the counting rules are testable on their own. */
export function computeStats(state: EditorState): EditorStats {
  const doc = state.doc
  const words = doc.toString().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0
  const head = state.selection.main.head
  const cursorLine = doc.lineAt(head)
  return {
    words,
    characters: doc.length,
    lines: doc.lines,
    line: cursorLine.number,
    column: head - cursorLine.from + 1
  }
}

let pending: ReturnType<typeof setTimeout> | null = null

/** Debounced update — for keystrokes and cursor moves. */
export function scheduleStatsUpdate(state: EditorState): void {
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    pending = null
    useEditorStats.setState(computeStats(state))
  }, 150)
}

/**
 * Immediate update, for when a document appears rather than changes: opening a
 * note or switching tabs fires no editor update, so without this the counters
 * would sit at zero until the first keystroke.
 */
export function refreshStatsNow(state: EditorState): void {
  if (pending) {
    clearTimeout(pending)
    pending = null
  }
  useEditorStats.setState(computeStats(state))
}
