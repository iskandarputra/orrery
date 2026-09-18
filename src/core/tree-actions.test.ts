import { describe, expect, it } from 'vitest'
import { matchesAnyGlob, parsePatternList } from './glob'
import {
  canDropInto,
  copyName,
  dropDir,
  folderInclude,
  isSameOrInside,
  planPaste,
  relativeToRoot
} from './tree-actions'

const names = (...list: string[]): ReadonlySet<string> => new Set(list)

describe('isSameOrInside', () => {
  it('is the folder itself and anything under it', () => {
    expect(isSameOrInside('/v/notes', '/v/notes')).toBe(true)
    expect(isSameOrInside('/v/notes/a/b.md', '/v/notes')).toBe(true)
  })

  it('is not a sibling that shares a prefix', () => {
    expect(isSameOrInside('/v/notes-archive', '/v/notes')).toBe(false)
    expect(isSameOrInside('/v', '/v/notes')).toBe(false)
  })

  it('reads either separator and ignores a trailing one', () => {
    expect(isSameOrInside('C:\\v\\notes\\a.md', 'C:/v/notes/')).toBe(true)
  })
})

describe('copyName', () => {
  it('keeps the name when it is free', () => {
    expect(copyName('a.md', names('b.md'))).toBe('a.md')
  })

  it('adds copy, then numbers, before the extension', () => {
    expect(copyName('a.md', names('a.md'))).toBe('a copy.md')
    expect(copyName('a.md', names('a.md', 'a copy.md'))).toBe('a copy 2.md')
    expect(copyName('a.md', names('a.md', 'a copy.md', 'a copy 2.md'))).toBe('a copy 3.md')
  })

  it('keeps only the last extension at the end', () => {
    expect(copyName('a.test.ts', names('a.test.ts'))).toBe('a.test copy.ts')
  })

  it('names a folder and a dotfile without splitting them', () => {
    expect(copyName('notes', names('notes'))).toBe('notes copy')
    expect(copyName('.gitignore', names('.gitignore'))).toBe('.gitignore copy')
  })
})

describe('planPaste', () => {
  it('copies into another folder under the same name', () => {
    expect(planPaste('copy', '/v/a/x.md', '/v/b', names())).toEqual({ kind: 'paste', name: 'x.md' })
  })

  it('copies beside the original as a copy, never over it', () => {
    expect(planPaste('copy', '/v/a/x.md', '/v/a', names('x.md'))).toEqual({
      kind: 'paste',
      name: 'x copy.md'
    })
    expect(planPaste('copy', '/v/a/x.md', '/v/b', names('x.md'))).toEqual({
      kind: 'paste',
      name: 'x copy.md'
    })
  })

  it('does nothing for a cut pasted back where it is', () => {
    expect(planPaste('cut', '/v/a/x.md', '/v/a', names('x.md'))).toEqual({ kind: 'nothing' })
  })

  it('moves into another folder, and refuses to rename on the way', () => {
    expect(planPaste('cut', '/v/a/x.md', '/v/b', names())).toEqual({ kind: 'paste', name: 'x.md' })
    expect(planPaste('cut', '/v/a/x.md', '/v/b', names('x.md'))).toEqual({
      kind: 'refused',
      reason: 'exists'
    })
  })

  it('never puts a folder inside itself, by either means', () => {
    for (const mode of ['cut', 'copy'] as const) {
      expect(planPaste(mode, '/v/notes', '/v/notes', names()).kind, mode).toBe('refused')
      expect(planPaste(mode, '/v/notes', '/v/notes/deep', names()), mode).toEqual({
        kind: 'refused',
        reason: 'into-itself'
      })
    }
  })

  it('lets a folder go into a sibling that shares its prefix', () => {
    expect(planPaste('cut', '/v/notes', '/v/notes-archive', names())).toEqual({
      kind: 'paste',
      name: 'notes'
    })
  })
})

describe('relativeToRoot', () => {
  it('is the path under the vault, with forward slashes', () => {
    expect(relativeToRoot('/v', '/v/notes/a.md')).toBe('notes/a.md')
    expect(relativeToRoot('C:\\v', 'C:\\v\\notes\\a.md')).toBe('notes/a.md')
  })

  it('is empty for the vault itself', () => {
    expect(relativeToRoot('/v', '/v')).toBe('')
    expect(relativeToRoot('/v/', '/v')).toBe('')
  })
})

describe('folderInclude', () => {
  it('searches the folder and everything under it, and nothing beside it', () => {
    const include = parsePatternList(folderInclude('notes/deep'))
    expect(matchesAnyGlob('notes/deep/a.md', include)).toBe(true)
    expect(matchesAnyGlob('notes/deep/more/b.md', include)).toBe(true)
    expect(matchesAnyGlob('notes/a.md', include)).toBe(false)
    expect(matchesAnyGlob('notes/deeper/a.md', include)).toBe(false)
  })

  it('is no filter at all for the vault itself', () => {
    expect(folderInclude('')).toBe('')
  })

  it('keeps a comma in a folder name from splitting the pattern in two', () => {
    const include = parsePatternList(folderInclude('a,b'))
    expect(include).toHaveLength(1)
    expect(matchesAnyGlob('a,b/x.md', include)).toBe(true)
    expect(matchesAnyGlob('b/x.md', include)).toBe(false)
  })
})

describe('dropDir', () => {
  it('is the folder dropped on, or the folder a file sits in', () => {
    expect(dropDir({ path: '/v/notes', kind: 'directory' })).toBe('/v/notes')
    expect(dropDir({ path: '/v/notes/a.md', kind: 'file' })).toBe('/v/notes')
  })
})

describe('canDropInto', () => {
  it('takes files into another folder', () => {
    expect(canDropInto(['/v/a.md', '/v/b.md'], '/v/notes', 'cut')).toBe(true)
  })

  it('refuses a folder into itself or anything inside it', () => {
    expect(canDropInto(['/v/notes'], '/v/notes', 'cut')).toBe(false)
    expect(canDropInto(['/v/notes'], '/v/notes/deep', 'cut')).toBe(false)
    expect(canDropInto(['/v/notes'], '/v/notes-archive', 'cut')).toBe(true)
  })

  it('refuses a move that would leave everything where it is', () => {
    expect(canDropInto(['/v/a.md', '/v/b.md'], '/v', 'cut')).toBe(false)
    // One of them does move, so the drag is worth taking.
    expect(canDropInto(['/v/a.md', '/v/notes/c.md'], '/v', 'cut')).toBe(true)
    // A copy into the same folder duplicates it, which is not nothing.
    expect(canDropInto(['/v/a.md'], '/v', 'copy')).toBe(true)
  })

  it('refuses a drag of nothing', () => {
    expect(canDropInto([], '/v/notes', 'cut')).toBe(false)
  })
})
