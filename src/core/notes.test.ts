import { describe, expect, it } from 'vitest'
import type { FileNode } from '@shared/types'
import {
  buildFileIndex,
  buildNoteIndex,
  filesFromPaths,
  notesFromPaths,
  resolveNote
} from './notes'

const tree: FileNode = {
  name: 'vault',
  path: '/vault',
  kind: 'directory',
  children: [
    { name: 'Inbox.md', path: '/vault/Inbox.md', kind: 'file' },
    { name: 'image.png', path: '/vault/image.png', kind: 'file' },
    {
      name: 'projects',
      path: '/vault/projects',
      kind: 'directory',
      children: [
        { name: 'Orrery Plan.md', path: '/vault/projects/Orrery Plan.md', kind: 'file' },
        { name: 'notes.markdown', path: '/vault/projects/notes.markdown', kind: 'file' }
      ]
    }
  ]
}

describe('buildNoteIndex', () => {
  it('collects markdown files recursively with stems', () => {
    const index = buildNoteIndex(tree)
    expect(index).toEqual([
      { path: '/vault/Inbox.md', stem: 'Inbox' },
      { path: '/vault/projects/Orrery Plan.md', stem: 'Orrery Plan' },
      { path: '/vault/projects/notes.markdown', stem: 'notes' }
    ])
  })

  it('returns empty for a null tree', () => {
    expect(buildNoteIndex(null)).toEqual([])
  })
})

describe('resolveNote', () => {
  const index = buildNoteIndex(tree)

  it('matches stems case-insensitively', () => {
    expect(resolveNote(index, 'orrery plan', '/vault/Inbox.md')?.path).toBe(
      '/vault/projects/Orrery Plan.md'
    )
    expect(resolveNote(index, 'INBOX', '/vault/Inbox.md')?.path).toBe('/vault/Inbox.md')
  })

  it('returns null for unknown targets', () => {
    expect(resolveNote(index, 'Missing Note', '/vault/Inbox.md')).toBeNull()
  })
})

describe('resolveNote with more than one candidate', () => {
  const duplicates = [
    { path: '/vault/archive/Store.md', stem: 'Store' },
    { path: '/vault/projects/Store.md', stem: 'Store' }
  ]

  it('prefers the note beside the one doing the linking', () => {
    expect(resolveNote(duplicates, 'store', '/vault/projects/Plan.md')?.path).toBe(
      '/vault/projects/Store.md'
    )
  })

  it('gives the same answer whichever order the walk found them', () => {
    // `find` used to take the first match, so reversing the index changed the
    // answer. That is half of the bug: buildGraph kept the last match, so the
    // two halves of the app pointed at different files.
    const forwards = resolveNote(duplicates, 'store', '/vault/A.md')?.path
    const backwards = resolveNote([...duplicates].reverse(), 'store', '/vault/A.md')?.path
    expect(backwards).toBe(forwards)
  })
})

describe('buildFileIndex', () => {
  const tree = {
    name: 'v',
    path: '/v',
    kind: 'directory' as const,
    children: [
      { name: 'Note.md', path: '/v/Note.md', kind: 'file' as const },
      { name: 'main.ts', path: '/v/main.ts', kind: 'file' as const },
      {
        name: 'src',
        path: '/v/src',
        kind: 'directory' as const,
        children: [
          { name: 'deep.rs', path: '/v/src/deep.rs', kind: 'file' as const },
          { name: 'data.csv', path: '/v/src/data.csv', kind: 'file' as const }
        ]
      }
    ]
  }

  it('includes every file, which is the point of it', () => {
    // Quick open used to share the note index and could not find a code file.
    expect(
      buildFileIndex(tree)
        .map((f) => f.stem)
        .sort()
    ).toEqual(['Note.md', 'data.csv', 'deep.rs', 'main.ts'])
  })

  it('keeps the extension, so two files of the same name are told apart', () => {
    expect(buildFileIndex(tree).find((f) => f.path.endsWith('main.ts'))?.stem).toBe('main.ts')
  })

  it('descends into directories and carries the full path', () => {
    expect(buildFileIndex(tree).map((f) => f.path)).toContain('/v/src/deep.rs')
  })

  it('is empty for no tree', () => {
    expect(buildFileIndex(null)).toEqual([])
  })

  it('leaves the note index alone, which links still resolve against', () => {
    // A wikilink must not resolve to a TypeScript file.
    expect(buildNoteIndex(tree).map((n) => n.stem)).toEqual(['Note'])
  })
})

describe('notesFromPaths and filesFromPaths', () => {
  const paths = ['/v/Index.md', '/v/src/main.ts', '/v/Folder/Deep.markdown', '/v/pic.png']

  it('takes the markdown ones as notes, by their stems', () => {
    expect(notesFromPaths(paths)).toEqual([
      { path: '/v/Index.md', stem: 'Index' },
      { path: '/v/Folder/Deep.markdown', stem: 'Deep' }
    ])
  })

  it('takes everything as a file, by its whole name', () => {
    // Quick open is asked "where is that file" and has to find anything —
    // including the extension, because that is what people type.
    expect(filesFromPaths(paths).map((f) => f.stem)).toEqual([
      'Index.md',
      'main.ts',
      'Deep.markdown',
      'pic.png'
    ])
  })

  it('agrees with the tree walkers it replaces', () => {
    // The tree is read lazily now, so these are what the indexes are actually
    // built from; they must not quietly classify things differently.
    const tree = {
      name: 'v',
      path: '/v',
      kind: 'directory' as const,
      children: [
        { name: 'Index.md', path: '/v/Index.md', kind: 'file' as const },
        {
          name: 'src',
          path: '/v/src',
          kind: 'directory' as const,
          children: [{ name: 'main.ts', path: '/v/src/main.ts', kind: 'file' as const }]
        }
      ]
    }
    expect(notesFromPaths(['/v/Index.md', '/v/src/main.ts'])).toEqual(buildNoteIndex(tree))
    expect(filesFromPaths(['/v/Index.md', '/v/src/main.ts'])).toEqual(buildFileIndex(tree))
  })
})
