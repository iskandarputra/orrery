import { describe, expect, it } from 'vitest'
import { extractSection } from './section'

const DOC = `# Title

intro line

## Alpha

alpha body
more alpha

### Alpha child

nested body

## Beta

beta body
`

describe('extractSection', () => {
  it('returns the body under a heading, up to the next heading of the same level', () => {
    expect(extractSection(DOC, 'Alpha')).toBe('alpha body\nmore alpha\n\n### Alpha child\n\nnested body')
  })

  it('stops at a higher-level heading too', () => {
    expect(extractSection(DOC, 'Alpha child')).toBe('nested body')
  })

  it('reads the top section under the title', () => {
    expect(extractSection(DOC, 'Title')).toContain('intro line')
    expect(extractSection(DOC, 'Title')).toContain('## Alpha')
  })

  it('takes the last section to the end of the note', () => {
    expect(extractSection(DOC, 'Beta')).toBe('beta body')
  })

  it('matches the heading regardless of case and spacing', () => {
    expect(extractSection(DOC, '  alpha  ')).toBe(extractSection(DOC, 'Alpha'))
  })

  it('returns null when the heading is not there', () => {
    expect(extractSection(DOC, 'Nowhere')).toBeNull()
  })

  it('ignores a heading-looking line inside a code fence', () => {
    const doc = '# Real\n\n```\n## Fake\n```\n\nbody\n'
    expect(extractSection(doc, 'Fake')).toBeNull()
    expect(extractSection(doc, 'Real')).toContain('## Fake')
  })
})
