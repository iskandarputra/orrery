import { create } from 'zustand'

/**
 * A counter per buffer, bumped on every document change. Views that render
 * *from* the CodeMirror document rather than into it (the canvas board) need a
 * signal to re-read after an edit — including one they didn't make, like undo.
 *
 * Its own tiny store, like editor stats, so keystrokes never touch the app store.
 */
export const useDocVersion = create<Record<string, number>>(() => ({}))

export function bumpDocVersion(id: string): void {
  useDocVersion.setState((versions) => ({ [id]: (versions[id] ?? 0) + 1 }))
}

export function clearDocVersion(id: string): void {
  useDocVersion.setState((versions) => {
    const next = { ...versions }
    delete next[id]
    return next
  }, true)
}
