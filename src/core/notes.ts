import type { FileNode } from '@shared/types'
import { resolve } from './link-resolution'
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

/**
 * Resolve a link target to any file in the vault, by its whole name.
 *
 * Separate from `resolveNote` because the two are asked different questions.
 * `[[Ideas]]` means the note called Ideas; `[[paper.pdf]]` names a file, and
 * treating that as a note would offer to create `paper.pdf.md`. Both share
 * `pick`, which matches on `stem` directly: what tells the two functions
 * apart is not the matching logic but the index each is handed. This one is
 * given `buildFileIndex`'s output, whose `stem` keeps the extension, so
 * `paper.pdf` is itself a whole name to match.
 *
 * `fromPath` is the file the link is written in, and it is required rather than
 * optional: it is what decides between two files of the same name, and a
 * default would quietly give a different answer here than the graph gives.
 */
export function resolveFile(
  index: readonly NoteRef[],
  target: string,
  fromPath: string
): NoteRef | null {
  return pick(index, target, fromPath)
}

/**
 * Resolve a wikilink target to a note (case-insensitive stem match).
 *
 * Given `buildNoteIndex`'s output, whose `stem` has no extension, so a link
 * matches by title rather than by file name.
 */
export function resolveNote(
  index: readonly NoteRef[],
  target: string,
  fromPath: string
): NoteRef | null {
  return pick(index, target, fromPath)
}

/**
 * The one place both resolvers pick among same-name matches.
 *
 * A vault holding two `Store.md` used to be answered by `Array.find`, so the
 * result was whichever the directory walk reached first: reverse the walk and
 * the same link opened a different file. Ranking through the shared arbiter
 * makes the answer depend on `fromPath`, not on read order.
 */
function pick(index: readonly NoteRef[], target: string, fromPath: string): NoteRef | null {
  const needle = target.trim().toLowerCase()
  const matches = index.filter((ref) => ref.stem.toLowerCase() === needle)
  const found = resolve(
    fromPath,
    matches.map((ref) => ref.path),
    {
      tieBreak: 'nearest',
      whenEmpty: { status: 'missing', at: target }
    }
  )
  if (found.status !== 'resolved') return null
  return matches.find((ref) => ref.path === found.to) ?? null
}
