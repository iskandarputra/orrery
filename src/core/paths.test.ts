import { describe, expect, it } from 'vitest'
import { basename, dirname, extname, isMarkdownFile, stem } from './paths'

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
