import { create } from 'zustand'
import type { EditorState } from '@codemirror/state'

export interface EditorStats {
  words: number
  characters: number
  line: number
  column: number
}

/**
 * High-frequency editor stats live in their own tiny store so keystrokes
 * never touch the main app store (StatusBar is the only subscriber).
 */
export const useEditorStats = create<EditorStats>(() => ({
  words: 0,
  characters: 0,
  line: 1,
  column: 1
}))

let pending: ReturnType<typeof setTimeout> | null = null

export function scheduleStatsUpdate(state: EditorState): void {
  if (pending) clearTimeout(pending)
  pending = setTimeout(() => {
    pending = null
    const doc = state.doc
    const text = doc.toString()
    const words = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)?.length ?? 0
    const head = state.selection.main.head
    const line = doc.lineAt(head)
    useEditorStats.setState({
      words,
      characters: doc.length,
      line: line.number,
      column: head - line.from + 1
    })
  }, 150)
}
