import { syntaxTree } from '@codemirror/language'
import type { EditorState, Extension, Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'
import type { BuildContext, Feature } from './context'
import { selectionTouches, selectionTouchesLines } from './context'

const concealDeco = Decoration.replace({})

export interface BuiltDecorations {
  all: Range<Decoration>[]
  conceals: Range<Decoration>[]
}

/**
 * Single syntax-tree walk over the given ranges; features receive the nodes
 * they registered for. Pure over (state, ranges) — unit-testable without a view.
 */
export function buildDecorationRanges(
  state: EditorState,
  features: Feature[],
  ranges: readonly { from: number; to: number }[],
  reveal = true
): BuiltDecorations {
  const handlers = new Map<string, Feature[]>()
  for (const feature of features) {
    for (const name of feature.nodes) {
      const list = handlers.get(name)
      if (list) list.push(feature)
      else handlers.set(name, [feature])
    }
  }

  const all: Range<Decoration>[] = []
  const conceals: Range<Decoration>[] = []

  const ctx: BuildContext = {
    state,
    reading: !reveal,
    // Reading mode (reveal=false) renders statically: clicking never uncovers
    // the raw markdown around the cursor.
    revealed: (from, to) => reveal && selectionTouches(state, from, to),
    lineRevealed: (from, to) => reveal && selectionTouchesLines(state, from, to),
    add: (deco) => all.push(deco),
    conceal: (from, to) => {
      if (from >= to) return
      // Split at every line end, because a replacing decoration may not cross
      // one when it comes from a view plugin: `@codemirror/view` throws
      // "Decorations that replace line breaks may not be specified via
      // plugins", the pane's React tree unmounts, and the window goes blank
      // with nothing on screen saying why. Reading mode found this by
      // concealing a comment written across several lines in one span.
      //
      // The line breaks survive the split, so a construct that has to vanish
      // whole rather than line by line cannot be a feature here at all: that
      // needs a block decoration, which is legal only from the state, which is
      // why `frontmatter.ts` is a state field of its own.
      let start = from
      while (start < to) {
        const line = state.doc.lineAt(start)
        const end = Math.min(to, line.to)
        if (end > start) {
          const deco = concealDeco.range(start, end)
          all.push(deco)
          conceals.push(deco)
        }
        start = line.to + 1
      }
    }
  }

  for (const { from, to } of ranges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const list = handlers.get(node.name)
        if (list) for (const feature of list) feature.enter(node, ctx)
      }
    })
  }

  return { all, conceals }
}

/**
 * The rendering half: rebuilds decorations when the doc, viewport, selection
 * or parse tree changes. Conceal ranges double as atomic ranges so the cursor
 * skips over hidden syntax instead of getting trapped inside it.
 *
 * Inline-only decorations are safe in a ViewPlugin; nothing here changes
 * vertical geometry across line breaks (block widgets would need a StateField).
 */
export function livePreviewPlugin(features: Feature[], reveal = true): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none
      conceals: DecorationSet = Decoration.none

      constructor(view: EditorView) {
        this.build(view)
      }

      update(update: ViewUpdate): void {
        if (
          update.docChanged ||
          update.viewportChanged ||
          (reveal && update.selectionSet) ||
          syntaxTree(update.state) !== syntaxTree(update.startState)
        ) {
          this.build(update.view)
        }
      }

      private build(view: EditorView): void {
        const { all, conceals } = buildDecorationRanges(
          view.state,
          features,
          view.visibleRanges,
          reveal
        )
        this.decorations = Decoration.set(all, true)
        this.conceals = Decoration.set(conceals, true)
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (p) =>
        EditorView.atomicRanges.of((view) => view.plugin(p)?.conceals ?? Decoration.none)
    }
  )

  return plugin
}
