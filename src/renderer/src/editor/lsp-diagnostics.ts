import { setDiagnostics, type Diagnostic } from '@codemirror/lint'
import type { EditorState } from '@codemirror/state'
import { positionToOffset } from './lsp-position'
import type { EditorView } from '@codemirror/view'
import type { LspDiagnostic } from '@shared/types'

/** LSP severities map onto CodeMirror's three, with hints shown as info. */
const SEVERITY: Record<LspDiagnostic['severity'], Diagnostic['severity']> = {
  error: 'error',
  warning: 'warning',
  info: 'info',
  hint: 'info'
}

export function toCodeMirrorDiagnostics(
  state: EditorState,
  incoming: LspDiagnostic[]
): Diagnostic[] {
  return incoming
    .map((d) => {
      const from = positionToOffset(state, { line: d.startLine, character: d.startChar })
      const to = positionToOffset(state, { line: d.endLine, character: d.endChar })
      return {
        // An empty range draws nothing, so a zero-width diagnostic is widened
        // to the character it sits on.
        from,
        to: to > from ? to : Math.min(from + 1, state.doc.length),
        severity: SEVERITY[d.severity],
        message: d.source ? `${d.message} (${d.source})` : d.message
      }
    })
    .sort((a, b) => a.from - b.from)
}

/** Draw a server's diagnostics for the document currently in `view`. */
export function applyDiagnostics(view: EditorView, incoming: LspDiagnostic[]): void {
  view.dispatch(setDiagnostics(view.state, toCodeMirrorDiagnostics(view.state, incoming)))
}
