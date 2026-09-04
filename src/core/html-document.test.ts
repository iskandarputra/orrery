import { describe, expect, it } from 'vitest'
import { buildPreview, isHtmlFile } from './html-document'

const options = { allowRemote: false }

/** The `content` of the injected policy meta, unescaped enough to read. */
function policyOf(srcdoc: string): string {
  const match = /<meta http-equiv="Content-Security-Policy" content="([^"]*)"/.exec(srcdoc)
  return match?.[1]?.replace(/&quot;/g, '"').replace(/&amp;/g, '&') ?? ''
}

describe('which files the reader claims', () => {
  it('takes the html extensions and leaves everything else', () => {
    for (const name of ['page.html', 'PAGE.HTM', 'a/b/index.xhtml']) {
      expect(isHtmlFile(name), name).toBe(true)
    }
    for (const name of ['note.md', 'script.js', 'data.json', 'style.css', 'htmlish']) {
      expect(isHtmlFile(name), name).toBe(false)
    }
  })

  it('does not claim a file that merely has html in its name', () => {
    expect(isHtmlFile('html')).toBe(false)
    expect(isHtmlFile('notes.html.bak')).toBe(false)
  })
})

describe('the policy the document is read under', () => {
  it('refuses everything it does not name', () => {
    expect(policyOf(buildPreview('<p>hi</p>', options).srcdoc)).toContain("default-src 'none'")
  })

  it('never grants scripts, however the document is written', () => {
    for (const source of [
      '<script>fetch("https://x")</script>',
      '<!doctype html><html><head><script src="app.js"></script></head></html>',
      '<img src=x onerror="alert(1)">'
    ]) {
      const policy = policyOf(buildPreview(source, options).srcdoc)
      expect(policy, source).not.toMatch(/script-src/)
      expect(policy, source).toContain("default-src 'none'")
    }
  })

  it('lets a file reach its own folder for styles, pictures and fonts', () => {
    const policy = policyOf(buildPreview('<p>hi</p>', options).srcdoc)
    expect(policy).toContain('img-src data: orrery-asset:')
    expect(policy).toContain("style-src 'unsafe-inline' orrery-asset:")
    expect(policy).toContain('font-src data: orrery-asset:')
  })

  it('keeps the network out until it is asked for', () => {
    expect(policyOf(buildPreview('<p>hi</p>', options).srcdoc)).not.toContain('https:')
  })

  it('opens images and media to the network when it is, and nothing else', () => {
    const policy = policyOf(buildPreview('<p>hi</p>', { ...options, allowRemote: true }).srcdoc)
    expect(policy).toContain('img-src data: orrery-asset: https:')
    expect(policy).toContain('media-src data: orrery-asset: https:')
    // Loading pictures is not a reason to fetch a stylesheet or a font.
    expect(policy).toContain("style-src 'unsafe-inline' orrery-asset:;")
    expect(policy).toContain('font-src data: orrery-asset:;')
  })

  it('leaves the base to the rewrite rather than the policy', () => {
    // The reader needs a base of its own, so a policy cannot simply forbid
    // them; `html-page.ts` strips the page's and adds one instead.
    expect(policyOf(buildPreview('<p>hi</p>', options).srcdoc)).not.toContain('base-uri')
  })
})

describe('where the injection goes', () => {
  it('goes inside the head, after the doctype', () => {
    const { srcdoc } = buildPreview(
      '<!doctype html>\n<html>\n<head>\n<title>T</title>\n</head>\n<body>x</body>\n</html>',
      options
    )
    expect(srcdoc.startsWith('<!doctype html>')).toBe(true)
    expect(srcdoc.indexOf('Content-Security-Policy')).toBeLessThan(srcdoc.indexOf('<title>'))
  })

  it('leaves the doctype first even when there is no head to aim at', () => {
    // Prepending would push the doctype down the document, where it stops being
    // one and the page renders in quirks mode.
    const { srcdoc } = buildPreview('<!DOCTYPE html>\n<p>bare</p>', options)
    expect(srcdoc.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(srcdoc).toContain('Content-Security-Policy')
  })

  it('lands before the content of a document with an html tag and no head', () => {
    const { srcdoc } = buildPreview('<html><body>x</body></html>', options)
    expect(srcdoc.indexOf('Content-Security-Policy')).toBeLessThan(srcdoc.indexOf('<body>'))
  })

  it('goes first for a bare fragment', () => {
    const { srcdoc } = buildPreview('<p>fragment</p>', options)
    expect(srcdoc.indexOf('Content-Security-Policy')).toBeLessThan(srcdoc.indexOf('<p>'))
  })

  it('keeps a head attribute rather than eating the tag', () => {
    const { srcdoc } = buildPreview('<head lang="en"><title>T</title></head>', options)
    expect(srcdoc).toContain('<head lang="en">')
  })

  it('writes no base of its own', () => {
    // A `<base>` resolves *every* relative URL against it, `href="#section"`
    // included — which turned every in-page link into an address for another
    // document that the policy then refused. Relative references are resolved
    // into the markup instead, before it gets here.
    expect(buildPreview('<img src="logo.png">', options).srcdoc).not.toContain('<base')
  })

  it('leaves the document itself untouched', () => {
    const source = '<!doctype html><html><head></head><body><p>Exactly this.</p></body></html>'
    const { srcdoc } = buildPreview(source, options)
    expect(srcdoc).toContain('</head><body><p>Exactly this.</p></body></html>')
    expect(
      srcdoc.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>|<base [^>]*>/g, '')
    ).toBe(source)
  })
})

describe('what the reader tells the person reading', () => {
  it('notices scripts so it can say they did not run', () => {
    expect(buildPreview('<script src="a.js"></script>', options).hasScripts).toBe(true)
    expect(buildPreview('<p>none here</p>', options).hasScripts).toBe(false)
  })

  it('counts what the document would have fetched', () => {
    const source = `
      <link rel="stylesheet" href="https://cdn.example/site.css">
      <img src="https://images.example/a.png">
      <img src="//images.example/b.png">
      <video poster="http://x.example/p.jpg"></video>
      <style>body { background: url(https://bg.example/c.png) }</style>
    `
    expect(buildPreview(source, options).remoteCount).toBe(5)
  })

  it('counts nothing for a document that stays in its own folder', () => {
    const source = '<link rel="stylesheet" href="site.css"><img src="./logo.png">'
    expect(buildPreview(source, options).remoteCount).toBe(0)
  })

  it('does not count a link somebody could click as something fetched', () => {
    // Loading remote content would not change an `<a>`, so a count that
    // included one would be a number the button cannot act on.
    expect(buildPreview('<a href="https://example.com">out</a>', options).remoteCount).toBe(0)
  })

  it('counts the same document the same way whether or not remote is allowed', () => {
    const source = '<img src="https://images.example/a.png">'
    expect(buildPreview(source, { ...options, allowRemote: true }).remoteCount).toBe(1)
  })
})
