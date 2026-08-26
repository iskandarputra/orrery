import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { parseFully } from '../parse-fully'

describe('Lezer Markdown Comment AST Nodes', () => {
  it('identifies comment nodes in syntax tree', () => {
    const doc = `<!--\n  Multi line comment\n-->\n\nInline <!-- comment --> here.`
    const state = EditorState.create({
      doc,
      extensions: [markdown({ base: markdownLanguage })]
    })
    parseFully(state)
    const tree = parseFully(state)
    const nodeNames: string[] = []
    tree.iterate({
      enter: (node) => {
        nodeNames.push(node.name)
      }
    })
    expect(nodeNames.some((n) => n.toLowerCase().includes('comment'))).toBe(true)
  })
})
