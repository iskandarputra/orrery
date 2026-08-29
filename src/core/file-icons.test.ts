import { describe, expect, it } from 'vitest'
import { fileIcon } from './file-icons'

describe('by extension', () => {
  it('gives a language its own colour', () => {
    expect(fileIcon('main.ts')).toEqual({ shape: 'braces', colour: '#3178c6' })
    expect(fileIcon('main.rs').colour).toBe('#dea584')
    expect(fileIcon('main.go').colour).toBe('#00add8')
  })

  it('groups by the kind of thing a file is', () => {
    expect(fileIcon('a.html').shape).toBe('angle')
    expect(fileIcon('a.json').shape).toBe('brackets')
    expect(fileIcon('a.sh').shape).toBe('terminal')
    expect(fileIcon('a.png').shape).toBe('image')
    expect(fileIcon('a.zip').shape).toBe('binary')
  })

  it('leaves prose uncoloured, so the coloured ones stand out', () => {
    expect(fileIcon('Note.md')).toEqual({ shape: 'file-text', colour: null })
  })

  it('ignores case', () => {
    expect(fileIcon('MAIN.TS').colour).toBe('#3178c6')
  })

  it('reads the last extension, so a.test.ts is TypeScript', () => {
    expect(fileIcon('parser.test.ts').shape).toBe('braces')
    expect(fileIcon('bundle.tar.gz').shape).toBe('binary')
  })
})

describe('by whole name', () => {
  it('recognises files whose name says more than their extension', () => {
    // "package.json" says more about a project than "some JSON" does.
    expect(fileIcon('package.json').colour).toBe('#8bc500')
    expect(fileIcon('tsconfig.json').colour).toBe('#3178c6')
    expect(fileIcon('a.json').colour).toBe('#cbcb41')
  })

  it('recognises files that have no extension at all', () => {
    expect(fileIcon('Dockerfile').shape).toBe('terminal')
    expect(fileIcon('Makefile').shape).toBe('terminal')
    expect(fileIcon('LICENSE').shape).toBe('file-text')
  })

  it('recognises a dotfile as its whole name', () => {
    // `.gitignore` has no extension: the leading dot is not a separator.
    expect(fileIcon('.gitignore').colour).toBe('#f14e32')
  })
})

describe('anything else', () => {
  it('falls back to a plain file', () => {
    expect(fileIcon('mystery.qqq')).toEqual({ shape: 'file', colour: null })
    expect(fileIcon('noextension')).toEqual({ shape: 'file', colour: null })
    expect(fileIcon('')).toEqual({ shape: 'file', colour: null })
  })

  it('does not read a leading dot as an extension', () => {
    expect(fileIcon('.hidden')).toEqual({ shape: 'file', colour: null })
  })
})
