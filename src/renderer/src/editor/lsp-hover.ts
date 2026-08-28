import { hoverTooltip, type EditorView, type Tooltip } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { serverForFile } from '@core/lsp-servers'
import { invoke } from '@/services/client'
import { docPathFacet } from './doc-context'
import { offsetToPosition } from './lsp-position'

/**
 * Documentation on hover, from the language server.
 *
 * The tooltip renders as plain text rather than as the markdown servers
 * usually send. Rendering it would mean running a markdown pipeline over a
 * string the server controls and injecting the result into the page; the
 * signature — the part anyone hovers for — survives as text either way.
 */
export function lspHover(): Extension {
  return hoverTooltip(async (view: EditorView, pos: number): Promise<Tooltip | null> => {
    const path = view.state.facet(docPathFacet)
    if (!path || !serverForFile(path)) return null

    const { line, character } = offsetToPosition(view.state, pos)
    let text: string | null = null
    try {
      text = await invoke('lsp:hover', { path, line, character })
    } catch {
      return null
    }
    if (!text) return null
    // The document can move while the request is out; anchoring to the
    // position asked about keeps the tooltip beside what was hovered.
    return {
      pos,
      above: true,
      create: () => {
        const dom = document.createElement('div')
        dom.className = 'cm-or-hover'
        dom.textContent = text
        return { dom }
      }
    }
  })
}
