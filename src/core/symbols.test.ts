import { describe, expect, it } from 'vitest'
import { documentSymbols, parseLineTarget } from './symbols'

const names = (text: string, file: string): string[] =>
  documentSymbols(text, file).map((s) => s.name)

describe('markdown symbols', () => {
  it('lists headings with their depth', () => {
    const found = documentSymbols('# One\n\n## Two\n\n### Three\n', 'n.md')
    expect(found.map((s) => [s.name, s.depth, s.line])).toEqual([
      ['One', 0, 1],
      ['Two', 1, 3],
      ['Three', 2, 5]
    ])
  })

  it('ignores a # inside a fence, which is a comment and not a heading', () => {
    // The reason this is fence-aware: a shell script in a note is full of them.
    expect(names('# Real\n\n```sh\n# not a heading\n```\n\n## Also real\n', 'n.md')).toEqual([
      'Real',
      'Also real'
    ])
  })

  it('strips closing hashes', () => {
    expect(names('## Title ##\n', 'n.md')).toEqual(['Title'])
  })

  it('finds nothing in a note with no headings', () => {
    expect(names('just prose\n', 'n.md')).toEqual([])
  })
})

describe('code symbols', () => {
  it('finds functions, classes and arrow consts', () => {
    const src = [
      'export function parse(input: string) {',
      'class Lexer {',
      'export const build = (a) => a',
      'const notADeclaration = 42'
    ].join('\n')
    expect(names(src, 'a.ts')).toEqual(['parse', 'Lexer', 'build'])
  })

  it('finds declarations in languages that are not TypeScript', () => {
    expect(names('def handler(self):\n', 'a.py')).toEqual(['handler'])
    expect(names('pub async fn serve() {\n', 'a.rs')).toEqual(['serve'])
    expect(names('type Config struct {\n', 'a.go')).toEqual(['Config'])
  })

  it('does not mistake control flow for a method', () => {
    // `if (x) {` matches the shape of a method declaration exactly.
    expect(names('  if (ready) {\n  while (x) {\n  render() {\n', 'a.ts')).toEqual(['render'])
  })

  it('uses indentation as nesting, so a method sits under its class', () => {
    const found = documentSymbols('class A {\n  run() {\n', 'a.ts')
    expect(found.map((s) => s.depth)).toEqual([0, 1])
  })

  it('reads a code file rather than looking for headings in it', () => {
    // `# comment` in a shell script is not a symbol.
    expect(names('# a comment\nfunction go() {\n', 'a.sh')).toEqual(['go'])
  })
})

describe('parseLineTarget', () => {
  it('reads a line number', () => {
    expect(parseLineTarget('42', 100)).toBe(42)
  })

  it('clamps past the end rather than refusing', () => {
    // Someone typing a number larger than the file means "the end".
    expect(parseLineTarget('9999', 20)).toBe(20)
  })

  it('rejects what is not a line number', () => {
    expect(parseLineTarget('', 10)).toBeNull()
    expect(parseLineTarget('abc', 10)).toBeNull()
    expect(parseLineTarget('0', 10)).toBeNull()
  })

  it('survives an empty document', () => {
    expect(parseLineTarget('5', 0)).toBe(1)
  })
})
