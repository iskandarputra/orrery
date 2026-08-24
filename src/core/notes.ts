import type { FileNode } from '@shared/types'
import { isMarkdownFile, stem } from './paths'

export interface NoteRef {
  path: string
  /** File name without extension — what [[wikilinks]] refer to. */
  stem: string
}

/** Flatten a workspace tree into the markdown note index. */
export function buildNoteIndex(tree: FileNode | null): NoteRef[] {
  const notes: NoteRef[] = []
  const walk = (node: FileNode): void => {
    if (node.kind === 'file') {
      if (isMarkdownFile(node.path)) notes.push({ path: node.path, stem: stem(node.path) })
      return
    }
    node.children?.forEach(walk)
  }
  if (tree) walk(tree)
  return notes
}

/** Resolve a wikilink target to a note (case-insensitive stem match). */
export function resolveNote(index: readonly NoteRef[], target: string): NoteRef | null {
  const needle = target.trim().toLowerCase()
  return index.find((n) => n.stem.toLowerCase() === needle) ?? null
}
