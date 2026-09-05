import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Drawing a diagram, which is global state with an await in the middle.
 *
 * `mermaid.initialize` sets the library's one configuration and
 * `mermaid.render` reads it afterwards, so the interesting behaviour here is
 * not what a diagram looks like — it is what happens when two of them are
 * asked for at once, and what happens when the same one is asked for twice.
 * The library itself is mocked: what is being tested is the arrangement around
 * it.
 */

const initialize = vi.fn<(config: { theme?: string }) => void>()
const render = vi.fn<(id: string, code: string) => Promise<{ svg: string }>>()

/** The theme in force at the moment `render` was called, per the library. */
let current = ''

vi.mock('mermaid', () => ({
  default: {
    initialize: (config: { theme?: string }) => {
      current = config.theme ?? ''
      initialize(config)
    },
    // An await inside, which is where an interleaved `initialize` would land.
    render: async (id: string, code: string) => {
      const at = current
      await new Promise((resolve) => setTimeout(resolve, 5))
      render(id, code)
      return { svg: `<svg data-theme="${at}">${code}</svg>` }
    }
  }
}))

const { renderMermaidToString } = await import('./mermaid')

const svgOf = (result: Awaited<ReturnType<typeof renderMermaidToString>>): string =>
  'svg' in result ? result.svg : `ERROR ${result.error}`

beforeEach(() => {
  initialize.mockClear()
  render.mockClear()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('two diagrams at once', () => {
  it('each comes out in the theme it asked for', async () => {
    // The real case: the HTML reader always wants `default`, because it draws
    // onto somebody else's white page, while a note wants what the app is
    // wearing. Run together without a queue, the second `initialize` decides
    // what the first one looks like.
    const [dark, light] = await Promise.all([
      renderMermaidToString('graph TD;A-->B', 'dark'),
      renderMermaidToString('graph TD;A-->B', 'default')
    ])
    expect(svgOf(dark)).toContain('data-theme="dark"')
    expect(svgOf(light)).toContain('data-theme="default"')
  })

  it('draws many blocks of one diagram once between them', async () => {
    // A page repeating the same diagram draws it a single time; the rest of
    // them find it already done rather than queueing behind it.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => renderMermaidToString('graph TD;X-->Y', 'default'))
    )
    expect(render).toHaveBeenCalledTimes(1)
    for (const result of results) expect(svgOf(result)).toContain('X-->Y')
  })
})

describe('the same diagram twice', () => {
  it('is drawn once', async () => {
    // The reader rebuilds its whole document on a debounce, so without this
    // every diagram in a page is redrawn on every keystroke next door.
    await renderMermaidToString('graph TD;C-->D', 'default')
    await renderMermaidToString('graph TD;C-->D', 'default')
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('is drawn again for a different theme', () => {
    // Same source, different picture. The theme is part of what is remembered.
    return Promise.all([
      renderMermaidToString('graph TD;E-->F', 'default'),
      renderMermaidToString('graph TD;E-->F', 'dark')
    ]).then(([a, b]) => {
      expect(render).toHaveBeenCalledTimes(2)
      expect(svgOf(a)).toContain('data-theme="default"')
      expect(svgOf(b)).toContain('data-theme="dark"')
    })
  })
})

describe('a diagram that cannot be drawn', () => {
  it('says why, and is not re-parsed to be told again', async () => {
    render.mockImplementationOnce(() => {
      throw new Error('Parse error on line 1\nsecond line of the message')
    })
    const first = await renderMermaidToString('not a diagram at all', 'default')
    const second = await renderMermaidToString('not a diagram at all', 'default')
    // Only the first line: the rest is a diagram of the parser's own state.
    expect(first).toEqual({ error: 'Parse error on line 1' })
    expect(second).toEqual(first)
    expect(render).toHaveBeenCalledTimes(1)
  })

  it('does not stop the next one being drawn', async () => {
    render.mockImplementationOnce(() => {
      throw new Error('broken')
    })
    await renderMermaidToString('broken source', 'default')
    const after = await renderMermaidToString('graph TD;G-->H', 'default')
    expect(svgOf(after)).toContain('G-->H')
  })
})
