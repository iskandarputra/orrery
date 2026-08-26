import type { EditorState, Range } from '@codemirror/state'
import type { Decoration } from '@codemirror/view'
import type { SyntaxNodeRef } from '@lezer/common'

/**
 * Shared build context passed to every feature handler during the single
 * syntax-tree walk. Handlers add decorations; the plugin sorts and builds
 * the final sets.
 */
export interface BuildContext {
  state: EditorState
  /**
   * True in Reading mode: a static render that never reveals source. Features
   * that hide something entirely (rather than on the cursor) need to tell that
   * apart from "the cursor happens to be elsewhere".
   */
  reading: boolean
  /** True when a selection range touches [from, to] — syntax marks inside stay visible. */
  revealed(from: number, to: number): boolean
  /** True when a selection range touches any line overlapping [from, to]. */
  lineRevealed(from: number, to: number): boolean
  /** Add an inline/mark decoration. */
  add(deco: Range<Decoration>): void
  /** Add a conceal decoration; these also become atomic ranges for cursor motion. */
  conceal(from: number, to: number): void
}

/**
 * A live-preview feature: declares which Lezer markdown node names it wants
 * and decorates them. One module per markdown construct keeps features
 * independently testable and future ones (math, mermaid) additive.
 */
export interface Feature {
  nodes: readonly string[]
  enter(node: SyntaxNodeRef, ctx: BuildContext): void
}

export function selectionTouches(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from)
}

export function selectionTouchesLines(state: EditorState, from: number, to: number): boolean {
  const start = state.doc.lineAt(from)
  const end = to <= start.to ? start : state.doc.lineAt(to)
  return selectionTouches(state, start.from, end.to)
}
