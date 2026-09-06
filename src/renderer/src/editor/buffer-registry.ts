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

/**
 * A buffer that has not been looked at yet.
 *
 * Restoring a session builds a tab for every file that was open, and building
 * the `EditorState` is by far the most expensive part of it: for a large note
 * it is around 70ms, against under 3ms to read the file off the disk. Thirty
 * such tabs spent four and a half seconds on states for documents that are, at
 * most, four of them on screen.
 *
 * So a tab may start as the recipe instead. The state is built the first time
 * something asks for it, which is a pane about to show it or a save about to
 * read it, and it costs the same as it always did — once, for the one document
 * somebody is actually looking at.
 */
type Pending = () => BufferRuntime

const buffers = new Map<string, BufferRuntime>()
const pending = new Map<string, Pending>()

/** Build a pending buffer, if that is what this one still is. */
function settle(id: string): BufferRuntime | undefined {
  const make = pending.get(id)
  if (!make) return buffers.get(id)
  pending.delete(id)
  const runtime = make()
  buffers.set(id, runtime)
  return runtime
}

export const bufferRegistry = {
  create(id: string, state: EditorState, savedDoc: Text | null): void {
    pending.delete(id)
    buffers.set(id, { state, savedDoc })
  },
  /**
   * Register a buffer without building it.
   *
   * The recipe runs at most once, on the first `get`. It should read whatever
   * it needs at that point rather than closing over it: settings can change
   * between a session being restored and one of its tabs being opened, and the
   * document should be built the way it would have been built today.
   */
  createPending(id: string, make: Pending): void {
    buffers.delete(id)
    pending.set(id, make)
  },
  /** Whether this buffer has been built yet. For tests and for measuring. */
  isPending(id: string): boolean {
    return pending.has(id)
  },
  get(id: string): BufferRuntime | undefined {
    return settle(id)
  },
  /** Store the latest state (called when a tab goes to the background). */
  setState(id: string, state: EditorState): void {
    // Not `settle`: a state arriving from a live view replaces whatever the
    // recipe would have made, so building one first would be work thrown away.
    pending.delete(id)
    const buf = buffers.get(id)
    if (buf) buf.state = state
    else buffers.set(id, { state, savedDoc: null })
  },
  markSaved(id: string, doc: Text): void {
    const buf = settle(id)
    if (buf) buf.savedDoc = doc
  },
  isDirty(id: string, currentDoc: Text): boolean {
    const buf = settle(id)
    if (!buf) return false
    return buf.savedDoc === null ? currentDoc.length > 0 : !currentDoc.eq(buf.savedDoc)
  },
  remove(id: string): void {
    buffers.delete(id)
    pending.delete(id)
  },
  clear(): void {
    buffers.clear()
    pending.clear()
  }
}
