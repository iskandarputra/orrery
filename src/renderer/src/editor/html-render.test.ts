import { describe, expect, it } from 'vitest'
import { renderSafeHtml } from './html-render'

/** The rendered HTML, as markup, for comparing against what was asked for. */
function render(html: string): string {
  const host = document.createElement('div')
  host.appendChild(renderSafeHtml(html).fragment)
  return host.innerHTML
}

describe('renderSafeHtml', () => {
  it('renders the block every README opens with', () => {
    const out = render(
      '<h1 align="center">Orrery</h1>\n<p align="center">\n  <img alt="MIT" src="https://img.shields.io/badge/licence-MIT-blue.svg">\n</p>'
    )
    expect(out).toContain('<h1 align="center">Orrery</h1>')
    expect(out).toContain('<p align="center">')
    // Attributes come out in the policy's order rather than the author's.
    expect(out).toContain('src="https://img.shields.io/badge/licence-MIT-blue.svg"')
    expect(out).toContain('alt="MIT"')
  })

  it('keeps a link, and sends it outside the app', () => {
    const out = render('<a href="https://example.com" title="Home">Home</a>')
    expect(out).toContain('href="https://example.com"')
    expect(out).toContain('target="_blank"')
    expect(out).toContain('rel="noreferrer noopener"')
  })

  it('drops a script and everything in it', () => {
    // The contents of a script are the danger, so they are not kept as text.
    const { fragment, removed } = renderSafeHtml('<p>before</p><script>alert(1)</script>')
    const host = document.createElement('div')
    host.appendChild(fragment)
    expect(host.innerHTML).toBe('<p>before</p>')
    expect(host.textContent).not.toContain('alert')
    expect(removed).toContain('script')
  })

  it('unwraps a tag it does not know, keeping the words inside', () => {
    // A hole where the text was is worse than the text without its wrapper.
    expect(render('<marquee>still readable</marquee>')).toBe('still readable')
    expect(render('<span class="x">text</span>')).toBe('<span>text</span>')
  })

  it('strips every event handler', () => {
    const out = render('<img src="x.png" onerror="alert(1)" onload="alert(2)">')
    expect(out).toContain('src="x.png"')
    expect(out).not.toContain('onerror')
    expect(out).not.toContain('onload')
  })

  it('strips style, which could paint over the application', () => {
    expect(render('<div style="position:fixed;inset:0">x</div>')).toBe('<div>x</div>')
  })

  it('refuses a javascript: link but keeps its text', () => {
    const out = render('<a href="javascript:alert(1)">click me</a>')
    expect(out).not.toContain('javascript')
    expect(out).toContain('click me')
  })

  it('allows a relative image, which is the common case', () => {
    expect(render('<img src="assets/diagram.png" alt="d">')).toContain('src="assets/diagram.png"')
  })

  it('renders a details block, which is the other thing READMEs want', () => {
    const out = render('<details open><summary>More</summary><p>Body</p></details>')
    expect(out).toBe('<details open=""><summary>More</summary><p>Body</p></details>')
  })

  it('keeps a hand-written table with its spans', () => {
    const out = render('<table><tr><td colspan="2" align="center">both</td></tr></table>')
    expect(out).toContain('colspan="2"')
    expect(out).toContain('align="center"')
  })

  it('survives markup that is broken', () => {
    // The browser's parser closes what the author did not; nothing here throws.
    expect(() => render('<p>unclosed <b>bold')).not.toThrow()
    expect(render('<p>unclosed <b>bold')).toContain('bold')
  })

  it('reports what it took out', () => {
    const { removed } = renderSafeHtml('<iframe src="x"></iframe><custom-el>hi</custom-el>')
    expect(removed).toEqual(['custom-el', 'iframe'])
  })

  it('has nothing to say about an empty block', () => {
    expect(render('')).toBe('')
  })
})
