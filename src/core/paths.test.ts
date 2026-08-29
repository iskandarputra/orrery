import { describe, expect, it } from 'vitest'
import { retargetPath, basename, dirname, extname, isMarkdownFile, stem } from './paths'

describe('paths', () => {
  it('basename handles posix and windows separators', () => {
    expect(basename('/home/user/notes/todo.md')).toBe('todo.md')
    expect(basename('C:\\Users\\me\\todo.md')).toBe('todo.md')
    expect(basename('/home/user/notes/')).toBe('notes')
    expect(basename('todo.md')).toBe('todo.md')
  })

  it('dirname returns parent directory', () => {
    expect(dirname('/home/user/todo.md')).toBe('/home/user')
    expect(dirname('/todo.md')).toBe('/')
    expect(dirname('todo.md')).toBe('.')
  })

  it('extname extracts extensions, ignoring dotfiles', () => {
    expect(extname('note.md')).toBe('.md')
    expect(extname('archive.tar.gz')).toBe('.gz')
    expect(extname('.gitignore')).toBe('')
    expect(extname('README')).toBe('')
  })

  it('stem strips the extension', () => {
    expect(stem('/a/b/note.md')).toBe('note')
    expect(stem('README')).toBe('README')
  })

  it('isMarkdownFile recognizes markdown extensions case-insensitively', () => {
    expect(isMarkdownFile('a.md')).toBe(true)
    expect(isMarkdownFile('a.MARKDOWN')).toBe(true)
    expect(isMarkdownFile('a.txt')).toBe(false)
    expect(isMarkdownFile('a')).toBe(false)
  })
})

describe('retargetPath', () => {
  it('follows a file renamed directly', () => {
    expect(retargetPath('/v/old.md', '/v/old.md', '/v/new.md')).toBe('/v/new.md')
  })

  it('follows a file inside a renamed folder', () => {
    expect(retargetPath('/v/notes/a.md', '/v/notes', '/v/archive')).toBe('/v/archive/a.md')
  })

  it('does not drag along a sibling with a shared prefix', () => {
    // Renaming `notes` must leave `notes-archive` where it is; a bare
    // startsWith would move it and lose the file from every open tab.
    expect(retargetPath('/v/notes-archive/a.md', '/v/notes', '/v/x')).toBeNull()
    expect(retargetPath('/v/notes2.md', '/v/notes', '/v/x')).toBeNull()
  })

  it('reports null for a path the rename does not touch', () => {
    expect(retargetPath('/v/other.md', '/v/notes', '/v/x')).toBeNull()
  })

  it('handles a nested path several levels down', () => {
    expect(retargetPath('/v/a/b/c/d.md', '/v/a', '/v/z')).toBe('/v/z/b/c/d.md')
  })
})
