import { setDiagnostics, type Diagnostic } from '@codemirror/lint'
import type { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { LspDiagnostic } from '@shared/types'

/** LSP severities map onto CodeMirror's three, with hints shown as info. */
const SEVERITY: Record<LspDiagnostic['severity'], Diagnostic['severity']> = {
  error: 'error',
  warning: 'warning',
  info: 'info',
  hint: 'info'
}

/**
 * Convert a server's line/character positions into document offsets.
 *
 * The protocol counts lines and characters from zero and the document counts
 * lines from one, and a server can name a position the document no longer has —
 * diagnostics arrive asynchronously, so by the time they land the file may have
 * been edited under them. Out-of-range positions are clamped rather than
 * dropped: a diagnostic in roughly the right place is still worth showing, and
 * an unclamped offset throws inside CodeMirror.
 */
function toOffset(state: EditorState, line: number, character: number): number {
  const lineNumber = Math.min(Math.max(line + 1, 1), state.doc.lines)
  const docLine = state.doc.line(lineNumber)
  return Math.min(docLine.from + Math.max(character, 0), docLine.to)
}

export function toCodeMirrorDiagnostics(
  state: EditorState,
  incoming: LspDiagnostic[]
): Diagnostic[] {
  return incoming
    .map((d) => {
      const from = toOffset(state, d.startLine, d.startChar)
      const to = toOffset(state, d.endLine, d.endChar)
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
