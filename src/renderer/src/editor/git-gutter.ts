import { RangeSet, StateEffect, StateField, type EditorState } from '@codemirror/state'
import { GutterMarker, gutter, type EditorView } from '@codemirror/view'
import type { ChangeKind, LineChange } from '@core/git-diff'
import { invoke } from '@/services/client'
import { docPathFacet } from './doc-context'

/** Replace the whole set of marks for a buffer. */
export const setGitChanges = StateEffect.define<LineChange[]>()

class ChangeMarker extends GutterMarker {
  constructor(readonly kind: ChangeKind) {
    super()
  }
  override eq(other: ChangeMarker): boolean {
    return other.kind === this.kind
  }
  override toDOM(): Node {
    const span = document.createElement('span')
    span.className = `cm-or-git-mark cm-or-git-mark--${this.kind}`
    return span
  }
}

const MARKERS: Record<ChangeKind, ChangeMarker> = {
  added: new ChangeMarker('added'),
  modified: new ChangeMarker('modified'),
  removed: new ChangeMarker('removed')
}

function buildMarks(state: EditorState, changes: LineChange[]): RangeSet<GutterMarker> {
  const lines = state.doc.lines
  const ranges = changes
    // A diff computed a moment ago can name a line the document no longer has.
    .filter((c) => c.line >= 1 && c.line <= lines)
    .map((c) => MARKERS[c.kind].range(state.doc.line(c.line).from))
  return RangeSet.of(ranges, true)
}

/**
 * Marks anchored to document positions rather than line numbers.
 *
 * Anchoring matters while you type: a line inserted at the top of the file
 * would otherwise slide every mark below it one line out of true, and the
 * gutter would quietly point at the wrong code until the next save.
 */
export const gitMarks = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setGitChanges)) return buildMarks(tr.state, effect.value)
    }
    return value.map(tr.changes)
  }
})

/** Line numbers currently carrying a change bar — the field, read back. */
export function markedLines(state: EditorState): { line: number; kind: string }[] {
  const out: { line: number; kind: string }[] = []
  const iter = state.field(gitMarks).iter()
  while (iter.value) {
    out.push({
      line: state.doc.lineAt(iter.from).number,
      kind: (iter.value as ChangeMarker).kind
    })
    iter.next()
  }
  return out
}

/**
 * A change bar beside each line that differs from git HEAD.
 *
 * The gutter is present whenever it is enabled, rather than appearing with the
 * first change: a column that came and went would shift the document sideways
 * on every edit.
 */
export function gitGutter(): [typeof gitMarks, ReturnType<typeof gutter>] {
  return [
    gitMarks,
    gutter({
      class: 'cm-or-git-gutter',
      markers: (view) => view.state.field(gitMarks)
    })
  ]
}

/**
 * Ask main for this buffer's changed lines and install them.
 *
 * The path is re-checked before dispatching: a pane is reused across tab
 * switches, so a slow `git diff` could otherwise land its answer on whatever
 * file the user moved to in the meantime.
 */
export async function refreshGitGutter(view: EditorView): Promise<void> {
  const path = view.state.facet(docPathFacet)
  if (!path) return
  try {
    const changes = await invoke('git:fileChanges', { path })
    if (view.state.facet(docPathFacet) !== path) return
    view.dispatch({ effects: setGitChanges.of(changes) })
  } catch {
    // A gutter is not worth surfacing an error for.
  }
}
