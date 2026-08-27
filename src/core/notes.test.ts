import { describe, expect, it } from 'vitest'
import type { FileNode } from '@shared/types'
import { buildNoteIndex, resolveNote } from './notes'

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
