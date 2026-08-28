import {
  autocompletion,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'
import type { Extension } from '@codemirror/state'
import { serverForFile } from '@core/lsp-servers'
import { invoke } from '@/services/client'
import { docPathFacet } from './doc-context'
import { offsetToPosition } from './lsp-position'

/**
 * LSP completion kinds, as far as CodeMirror's icon set goes. The numbers are
 * the protocol's; anything not listed falls back to no icon rather than a
 * wrong one.
 */
const KIND: Record<number, string> = {
  2: 'method',
  3: 'function',
  4: 'function', // constructor
  5: 'property',
  6: 'variable',
  7: 'class',
  8: 'interface',
  9: 'namespace',
  10: 'property',
  13: 'enum',
  14: 'keyword',
  21: 'constant',
  22: 'type',
  23: 'type',
  25: 'type'
}

/** The identifier being typed, which is what the list filters against. */
const WORD = /[\w$]+$/

export function lspCompletion(): Extension {
  return autocompletion({
    override: [
      async (context: CompletionContext): Promise<CompletionResult | null> => {
        const path = context.state.facet(docPathFacet)
        if (!path || !serverForFile(path)) return null

        const before = context.matchBefore(WORD)
        // Nothing typed and not explicitly asked for: stay out of the way
        // rather than opening a list over every keystroke.
        if (!before && !context.explicit) return null

        const { line, character } = offsetToPosition(context.state, context.pos)
        let items: { label: string; detail?: string; kind?: number }[]
        try {
          items = await invoke('lsp:complete', { path, line, character })
        } catch {
          return null
        }
        if (context.aborted || items.length === 0) return null

        return {
          from: before ? before.from : context.pos,
          options: items.map((item) => ({
            label: item.label,
            ...(item.detail ? { detail: item.detail } : {}),
            ...(item.kind && KIND[item.kind] ? { type: KIND[item.kind] } : {})
          })),
          // The server re-filters as the word grows; re-asking on every letter
          // would mean a round trip per keystroke.
          validFor: WORD
        }
      }
    ]
  })
}
