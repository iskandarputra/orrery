import type { EditorState, Text } from '@codemirror/state'

/**
 * Document text lives in CodeMirror EditorStates, NOT in Zustand/React state —
 * the key performance decision: no large strings flow through React on
 * keystrokes. This registry holds the detached EditorState of every buffer
 * (background tabs keep undo history, selection and scroll for free) plus the
 * last-saved document for dirty comparison via structural equality.
 */
interface BufferRuntime {
  state: EditorState
  /** Snapshot of the doc at last save/load; null for never-saved untitled docs. */
  savedDoc: Text | null
}

const buffers = new Map<string, BufferRuntime>()

export const bufferRegistry = {
  create(id: string, state: EditorState, savedDoc: Text | null): void {
    buffers.set(id, { state, savedDoc })
  },
  get(id: string): BufferRuntime | undefined {
    return buffers.get(id)
  },
  /** Store the latest state (called when a tab goes to the background). */
  setState(id: string, state: EditorState): void {
    const buf = buffers.get(id)
    if (buf) buf.state = state
  },
  markSaved(id: string, doc: Text): void {
    const buf = buffers.get(id)
    if (buf) buf.savedDoc = doc
  },
  isDirty(id: string, currentDoc: Text): boolean {
    const buf = buffers.get(id)
    if (!buf) return false
    return buf.savedDoc === null ? currentDoc.length > 0 : !currentDoc.eq(buf.savedDoc)
  },
  remove(id: string): void {
    buffers.delete(id)
  },
  clear(): void {
    buffers.clear()
  }
}
