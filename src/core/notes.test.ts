import { describe, expect, it } from 'vitest'
import type { FileNode } from '@shared/types'
import { buildFileIndex, buildNoteIndex, resolveNote } from './notes'

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
    expect(resolveNote(index, 'orrery plan')?.path).toBe('/vault/projects/Orrery Plan.md')
    expect(resolveNote(index, 'INBOX')?.path).toBe('/vault/Inbox.md')
  })

  it('returns null for unknown targets', () => {
    expect(resolveNote(index, 'Missing Note')).toBeNull()
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
