import type { FileNode } from '@shared/types'
import { basename, isMarkdownFile, stem } from './paths'

export interface NoteRef {
  path: string
  /** File name without extension — what [[wikilinks]] refer to. */
  stem: string
}

/** Flatten a workspace tree into the markdown note index. */
/**
 * Every file in the vault, for opening one by name.
 *
 * Separate from the note index because the two answer different questions. A
 * wikilink resolves to a note and should not find a TypeScript file; quick open
 * is asked "where is that file" and should find anything, which is why it could
 * not find a single one while it shared an index built for links.
 */
export function buildFileIndex(tree: FileNode | null): NoteRef[] {
  const files: NoteRef[] = []
  const walk = (node: FileNode): void => {
    if (node.kind === 'file') {
      files.push({ path: node.path, stem: basename(node.path) })
      return
    }
    node.children?.forEach(walk)
  }
  if (tree) walk(tree)
  return files
}

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
