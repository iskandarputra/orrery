import { describe, expect, it } from 'vitest'
import { globToRegExp, matchesAnyGlob, parsePatternList } from './glob'

const matches = (path: string, pattern: string): boolean => matchesAnyGlob(path, [pattern])

describe('parsePatternList', () => {
  it('splits on commas and trims', () => {
    expect(parsePatternList('*.ts, *.md ,,  ')).toEqual(['*.ts', '*.md'])
  })

  it('is empty for an empty string', () => {
    expect(parsePatternList('   ')).toEqual([])
  })
})

describe('a pattern without a slash is about the file name', () => {
  it('matches at any depth, which is what makes *.ts useful', () => {
    expect(matches('main.ts', '*.ts')).toBe(true)
    expect(matches('src/deep/main.ts', '*.ts')).toBe(true)
  })

  it('does not match a different extension', () => {
    expect(matches('src/main.tsx', '*.ts')).toBe(false)
  })

  it('matches an exact name anywhere', () => {
    expect(matches('a/b/package.json', 'package.json')).toBe(true)
  })
})

describe('a pattern with a slash is about the path', () => {
  it('anchors at the root', () => {
    expect(matches('src/main.ts', 'src/*.ts')).toBe(true)
    expect(matches('lib/main.ts', 'src/*.ts')).toBe(false)
  })

  it('does not let * cross a separator', () => {
    // The reason `*` and `**` are distinct: `src/*.ts` is one level, not all.
    expect(matches('src/deep/main.ts', 'src/*.ts')).toBe(false)
  })
})

describe('**', () => {
  it('crosses separators', () => {
    expect(matches('src/a/b/main.ts', 'src/**')).toBe(true)
    expect(matches('src/main.ts', 'src/**')).toBe(true)
  })

  it('matches zero directories, so **/*.ts covers a file in the root', () => {
    // Written as `(?:.*/)?` rather than `.*/` for exactly this case.
    expect(matches('main.ts', '**/*.ts')).toBe(true)
    expect(matches('a/b/main.ts', '**/*.ts')).toBe(true)
  })

  it('still respects the rest of the pattern', () => {
    expect(matches('a/b/main.test.ts', '**/*.test.ts')).toBe(true)
    expect(matches('a/b/main.ts', '**/*.test.ts')).toBe(false)
  })
})

describe('?', () => {
  it('matches exactly one character and never a separator', () => {
    expect(matches('a.ts', '?.ts')).toBe(true)
    expect(matches('ab.ts', '?.ts')).toBe(false)
    expect(matches('a/b.ts', 'a?b.ts')).toBe(false)
  })
})

describe('regex characters in a pattern are literal', () => {
  it('does not treat a dot as any character', () => {
    expect(matches('mainXts', '*.ts')).toBe(false)
  })

  it('does not treat + or ( as syntax', () => {
    expect(matches('a+b.md', 'a+b.md')).toBe(true)
    expect(matches('note(1).md', 'note(1).md')).toBe(true)
  })

  it('produces a valid regex for a pattern full of metacharacters', () => {
    expect(() => globToRegExp('a[b]c{d}e(f)g|h^i$j.k+l')).not.toThrow()
  })
})

describe('lists', () => {
  it('matches if any pattern does', () => {
    expect(matchesAnyGlob('a/b.md', ['*.ts', '*.md'])).toBe(true)
  })

  it('matches nothing when the list is empty', () => {
    // Callers decide what no-filter means; the matcher does not guess.
    expect(matchesAnyGlob('a/b.md', [])).toBe(false)
  })
})
