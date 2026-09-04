import { describe, expect, it } from 'vitest'
import { declaresSingleDollar, findMath } from './html-math'

const exprs = (text: string, single = false): string[] =>
  findMath(text, single).map((m) => `${m.display ? 'D' : 'I'}:${m.expr}`)

describe('findMath', () => {
  it('finds the three delimiters nothing else writes', () => {
    expect(exprs('a $$x^2$$ b \\[y\\] c \\(z\\) d')).toEqual(['D:x^2', 'D:y', 'I:z'])
  })

  it('reports where each one is, so the text can be rebuilt around it', () => {
    const [span] = findMath('ab $$x$$ cd')
    expect(span).toMatchObject({ start: 3, end: 8, expr: 'x', display: true })
    expect('ab $$x$$ cd'.slice(span!.start, span!.end)).toBe('$$x$$')
  })

  it('leaves a single dollar alone by default', () => {
    // The whole reason for the opt-in: this is a price list, not an equation.
    expect(exprs('it costs $5 to $10 depending')).toEqual([])
  })

  it('honours a single dollar when the page asked for it', () => {
    expect(exprs('mass $E = mc^2$ here', true)).toEqual(['I:E = mc^2'])
  })

  it('never reads $$ as an empty $…$ pair', () => {
    expect(exprs('$$x^2$$', true)).toEqual(['D:x^2'])
  })

  it('ignores an opener with no partner', () => {
    expect(exprs('$$ unclosed for the rest of the paragraph')).toEqual([])
    expect(exprs('a $5 and change', true)).toEqual([])
  })

  it('still finds a closed pair after an unclosed opener', () => {
    expect(exprs('\\(no partner and then $$x$$')).toEqual(['D:x'])
  })

  it('treats an escaped dollar as a dollar sign', () => {
    expect(exprs('\\$100 and \\$200', true)).toEqual([])
  })

  it('does not overlap two equations', () => {
    expect(exprs('$$a$$ and $$b$$')).toEqual(['D:a', 'D:b'])
  })

  it('is empty for text with no maths in it', () => {
    expect(exprs('just some prose')).toEqual([])
  })

  it('keeps an expression that spans lines', () => {
    expect(exprs('$$\n\\int_0^1\n$$')).toEqual(['D:\n\\int_0^1\n'])
  })
})

describe('declaresSingleDollar', () => {
  it('is true when the page configures it', () => {
    expect(declaresSingleDollar("window.MathJax = { tex: { inlineMath: [['$','$']] } };")).toBe(
      true
    )
    expect(declaresSingleDollar('MathJax = { tex: { inlineMath: [["$", "$"]] } }')).toBe(true)
  })

  it('is false when the page leaves the defaults alone', () => {
    expect(declaresSingleDollar('<script src="tex-mml-chtml.js"></script>')).toBe(false)
  })

  it('is false for a config that names some other delimiter', () => {
    expect(declaresSingleDollar("inlineMath: [['\\\\(','\\\\)']],")).toBe(false)
  })
})
