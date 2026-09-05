import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The rewrite a page goes through before the reader shows it.
 *
 * Everything here is a fact about a string, which is why it belongs in a unit
 * test: `e2e/html-reader.spec.ts` proves what a browser then does with that
 * string — that the script did not run, that the stylesheet did load — and
 * neither suite can stand in for the other. What this one is for is the long
 * tail of references a page can carry, where a miss shows up as a picture that
 * silently is not there rather than as anything a browser would complain about.
 *
 * Mermaid is mocked. Drawing a real diagram is slow, needs a layout engine
 * jsdom does not have, and would test mermaid rather than this file — what
 * matters here is what happens to the SVG once it is in the document.
 */

const MERMAID_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg"><g><text>costs $5</text></g>' +
  '<text>and \\(x\\) too</text></svg>'

type Drawn = { svg: string } | { error: string }

const renderMermaidToString = vi.fn(
  async (_code: string, _theme?: 'dark' | 'default'): Promise<Drawn> => ({ svg: MERMAID_SVG })
)

vi.mock('./live-preview/mermaid', () => ({
  renderMermaidToString: (code: string, theme?: 'dark' | 'default') =>
    renderMermaidToString(code, theme)
}))

const { preparePage } = await import('./html-page')

/** A file in a folder, so a relative reference has somewhere to resolve to. */
const DOC = '/vault/notes/page.html'

/** The prepared document, parsed back so it can be asked questions. */
async function prepared(source: string, docPath: string | null = DOC): Promise<Document> {
  const { html } = await preparePage(source, docPath)
  return new DOMParser().parseFromString(html, 'text/html')
}

beforeEach(() => {
  renderMermaidToString.mockClear()
})

describe('references in markup', () => {
  it('resolves a relative one against the file’s own folder', async () => {
    const doc = await prepared('<body><img src="pics/logo.png"></body>')
    expect(doc.querySelector('img')?.getAttribute('src')).toBe(
      'orrery-asset://local/vault/notes/pics/logo.png'
    )
  })

  it('leaves an absolute one, a data URI and a fragment alone', async () => {
    const doc = await prepared(
      '<body><img id="a" src="https://example.com/x.png">' +
        '<img id="b" src="data:image/gif;base64,R0lGOD">' +
        '<use id="c" href="#sprite"></use></body>'
    )
    expect(doc.querySelector('#a')?.getAttribute('src')).toBe('https://example.com/x.png')
    expect(doc.querySelector('#b')?.getAttribute('src')).toBe('data:image/gif;base64,R0lGOD')
    expect(doc.querySelector('#c')?.getAttribute('href')).toBe('#sprite')
  })

  it('gives a protocol-relative address the scheme it needs', async () => {
    // It is counted among the remote references the reader offers to load, so
    // it has to be one the frame can actually fetch once that offer is taken.
    // Left bare it resolved against `orrery-preview:` and fetched nothing.
    const doc = await prepared('<body><img src="//cdn.example/x.png"></body>')
    expect(doc.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/x.png')
  })

  it('rebuilds a srcset candidate by candidate, keeping the descriptors', async () => {
    const doc = await prepared('<body><img srcset="a.png 1x, //cdn.example/b.png 2x"></body>')
    expect(doc.querySelector('img')?.getAttribute('srcset')).toBe(
      'orrery-asset://local/vault/notes/a.png 1x, https://cdn.example/b.png 2x'
    )
  })

  it('resolves an svg sprite, in both spellings of the attribute', async () => {
    const doc = await prepared(
      '<body><svg><use href="icons.svg#save"></use>' +
        '<image xlink:href="photo.png"></image></svg></body>'
    )
    expect(doc.querySelector('use')?.getAttribute('href')).toBe(
      'orrery-asset://local/vault/notes/icons.svg#save'
    )
    expect(doc.querySelector('image')?.getAttribute('xlink:href')).toBe(
      'orrery-asset://local/vault/notes/photo.png'
    )
  })

  it('leaves a link alone — it is a place to go, not something fetched', async () => {
    const doc = await prepared('<body><a href="other.html">next</a></body>')
    expect(doc.querySelector('a')?.getAttribute('href')).toBe('other.html')
  })

  it('leaves everything relative alone when the buffer has no folder', async () => {
    const doc = await prepared('<body><img src="logo.png"></body>', null)
    expect(doc.querySelector('img')?.getAttribute('src')).toBe('logo.png')
  })
})

describe('references in the page’s own CSS', () => {
  it('resolves url() in a style block', async () => {
    const doc = await prepared('<head><style>body{background:url(bg.png)}</style></head>')
    expect(doc.querySelector('style')?.textContent).toBe(
      'body{background:url("orrery-asset://local/vault/notes/bg.png")}'
    )
  })

  it('resolves url() in a style attribute', async () => {
    const doc = await prepared('<body><div style="background: url(\'bg.png\')"></div></body>')
    expect(doc.querySelector('div')?.getAttribute('style')).toBe(
      'background: url("orrery-asset://local/vault/notes/bg.png")'
    )
  })

  it('resolves an @import that names its file without url()', async () => {
    const doc = await prepared('<head><style>@import "theme.css";</style></head>')
    expect(doc.querySelector('style')?.textContent).toBe(
      '@import "orrery-asset://local/vault/notes/theme.css";'
    )
  })

  it('quotes what it rewrites, so a bracket in a path cannot end the url', async () => {
    const doc = await prepared('<head><style>b{background:url(my (draft).png)}</style></head>')
    const css = doc.querySelector('style')?.textContent ?? ''
    expect(css).toContain('url("orrery-asset://local/vault/notes/my%20(draft')
    expect(css.startsWith('b{background:url("')).toBe(true)
  })

  it('leaves a remote and a data url in CSS as they were', async () => {
    const source =
      '<head><style>a{background:url(https://example.com/x.png)}' +
      'b{background:url(data:image/gif;base64,R0lGOD)}</style></head>'
    const doc = await prepared(source)
    expect(doc.querySelector('style')?.textContent).toBe(
      'a{background:url(https://example.com/x.png)}b{background:url(data:image/gif;base64,R0lGOD)}'
    )
  })
})

describe('the base element', () => {
  it('is removed, so nothing left in the page can move a reference', async () => {
    const doc = await prepared('<head><base href="https://elsewhere.example/"></head>')
    expect(doc.querySelector('base')).toBeNull()
  })
})

describe('diagrams', () => {
  it('fills the block in place and stamps it the way mermaid does', async () => {
    const { html, diagrams } = await preparePage(
      '<body><pre class="mermaid">graph TD;A--&gt;B</pre></body>',
      DOC
    )
    expect(diagrams).toBe(1)
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const block = doc.querySelector('pre.mermaid')
    // Both halves matter: a page styling `pre.mermaid[data-processed]` gets
    // neither if the element is swapped out, and a local copy of mermaid that
    // the reader has been allowed to run skips an element already stamped.
    expect(block?.getAttribute('data-processed')).toBe('true')
    expect(block?.querySelector('svg')).not.toBeNull()
  })

  it('is drawn for the page’s own white ground, not the app’s theme', async () => {
    await preparePage('<body><div class="mermaid">graph TD;A--&gt;B</div></body>', DOC)
    expect(renderMermaidToString).toHaveBeenCalledWith(
      expect.stringContaining('graph TD'),
      'default'
    )
  })

  it('says why, in place, when one cannot be drawn', async () => {
    renderMermaidToString.mockResolvedValueOnce({ error: 'no such diagram type' })
    const { html, diagrams } = await preparePage(
      '<body><pre class="mermaid">nonsense</pre></body>',
      DOC
    )
    expect(diagrams).toBe(0)
    expect(html).toContain('Diagram could not be drawn: no such diagram type')
  })
})

describe('maths', () => {
  const MATHJAX = '<head><script src="https://cdn.example/tex-mml-chtml.js"></script></head>'

  it('typesets the TeX a page that asked for it carries', async () => {
    const { html, equations } = await preparePage(
      `${MATHJAX}<body><p>Einstein said \\(E = mc^2\\).</p></body>`,
      DOC
    )
    expect(equations).toBe(1)
    expect(html).toContain('<math')
  })

  it('does not go looking in a page that never asked', async () => {
    const { html, equations } = await preparePage('<body><p>a \\(b\\) c</p></body>', DOC)
    expect(equations).toBe(0)
    expect(html).toContain('a \\(b\\) c')
  })

  it('leaves a price list alone when the page did not declare single dollars', async () => {
    const { html } = await preparePage(`${MATHJAX}<body><p>it costs $5 to $10.</p></body>`, DOC)
    expect(html).toContain('it costs $5 to $10.')
    expect(html).not.toContain('<math')
  })

  it('leaves the source of a diagram alone', async () => {
    const { html } = await preparePage(`${MATHJAX}<body><pre>\\(x\\)</pre></body>`, DOC)
    expect(html).toContain('<pre>\\(x\\)</pre>')
  })

  it('does not reach inside a diagram it has just drawn', async () => {
    // The trap: the text of a drawn diagram sits in `<text>` and `<tspan>`
    // elements, which are not in `NOT_PROSE`, and a `<div class="mermaid">`
    // has no `<pre>` to be caught by. MathML inside an SVG draws nothing, so
    // an equation put there turned the label blank.
    const { html, equations } = await preparePage(
      `${MATHJAX}<body><div class="mermaid">graph TD;A--&gt;B</div></body>`,
      DOC
    )
    expect(equations).toBe(0)
    expect(html).not.toContain('<math')
    expect(html).toContain('and \\(x\\) too')
  })
})

describe('the document itself', () => {
  it('keeps its doctype, so it is not read in quirks mode', async () => {
    const { html } = await preparePage('<!doctype html><html><body>x</body></html>', DOC)
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
  })

  it('comes back whole, with the head and body it arrived with', async () => {
    const doc = await prepared('<html><head><title>Kept</title></head><body><p>x</p></body></html>')
    expect(doc.title).toBe('Kept')
    expect(doc.querySelector('body > p')?.textContent).toBe('x')
  })
})

describe('a query or a fragment on a reference', () => {
  it('is kept off the path, which is the part that gets escaped', async () => {
    const doc = await prepared(
      '<body><img src="pic.png?v=2"><svg><use href="i.svg#a"/></svg></body>'
    )
    expect(doc.querySelector('img')?.getAttribute('src')).toBe(
      'orrery-asset://local/vault/notes/pic.png?v=2'
    )
    expect(doc.querySelector('use')?.getAttribute('href')).toBe(
      'orrery-asset://local/vault/notes/i.svg#a'
    )
  })
})
