import { describe, expect, it } from 'vitest'
import { documentKind } from './document-kind'

describe('documentKind', () => {
  it('treats markdown extensions as notes', () => {
    expect(documentKind('Note.md')).toBe('markdown')
    expect(documentKind('Note.MARKDOWN')).toBe('markdown')
    expect(documentKind('/vault/deep/Note.mdown')).toBe('markdown')
  })

  it('treats .canvas as a board', () => {
    expect(documentKind('Board.canvas')).toBe('canvas')
    expect(documentKind('BOARD.CANVAS')).toBe('canvas')
  })

  it('treats everything else as code, so markdown never rewrites it', () => {
    // Each of these was displayed wrong when opened as markdown.
    expect(documentKind('data.json')).toBe('code')
    expect(documentKind('script.ts')).toBe('code')
    expect(documentKind('main.py')).toBe('code')
    expect(documentKind('notes.txt')).toBe('code')
  })

  it('treats an extensionless file as code rather than as a note', () => {
    // Makefile, LICENSE, Dockerfile: none of them are markdown, and all of
    // them have syntax markdown would happily eat.
    expect(documentKind('Makefile')).toBe('code')
    expect(documentKind('LICENSE')).toBe('code')
  })
})
