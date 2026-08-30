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

/**
 * The same two indexes, from a flat list of paths.
 *
 * The tree is read a directory at a time now, so it knows only about the parts
 * somebody has opened — which is the wrong thing to build an index from, since
 * a wikilink to a note three folders down has to resolve whether or not that
 * folder has ever been expanded. Main walks the vault once and hands over the
 * paths; the shape of the tree is not needed to know what is in it.
 */
export function notesFromPaths(paths: readonly string[]): NoteRef[] {
  const notes: NoteRef[] = []
  for (const filePath of paths) {
    if (isMarkdownFile(filePath)) notes.push({ path: filePath, stem: stem(filePath) })
  }
  return notes
}

export function filesFromPaths(paths: readonly string[]): NoteRef[] {
  return paths.map((filePath) => ({ path: filePath, stem: basename(filePath) }))
}

/** Resolve a wikilink target to a note (case-insensitive stem match). */
export function resolveNote(index: readonly NoteRef[], target: string): NoteRef | null {
  const needle = target.trim().toLowerCase()
  return index.find((n) => n.stem.toLowerCase() === needle) ?? null
}
