import { describe, expect, it } from 'vitest'
import { buildExportHtml } from './export-html'

describe('buildExportHtml', () => {
  it('renders GFM: headings, tables, task lists, strikethrough', async () => {
    const html = await buildExportHtml(
      'Doc',
      [
        '# Title',
        '',
        '| a | b |',
        '| --- | --- |',
        '| 1 | 2 |',
        '',
        '- [x] done',
        '',
        '~~gone~~'
      ].join('\n')
    )
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<table>')
    expect(html).toContain('type="checkbox"')
    expect(html).toContain('<del>gone</del>')
    expect(html).toContain('<title>Doc</title>')
    expect(html).toContain('<style>')
  })

  it('converts zymd syntax: wikilinks and highlights', async () => {
    const html = await buildExportHtml('t', 'see [[Note|the note]] and ==this==')
    expect(html).toContain('<span class="wikilink">the note</span>')
    expect(html).toContain('<mark>this</mark>')
  })

  it('escapes the title', async () => {
    const html = await buildExportHtml('<x>&', 'body')
    expect(html).toContain('<title>&lt;x&gt;&amp;</title>')
  })
})
