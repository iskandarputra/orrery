import { emojiCompletionSource, slashCompletionSource } from '@/editor/insert-complete'
import { tagCompletionSource } from '@/editor/tag-complete'
import {
  autocompletion,
  type CompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'
import type { Extension, Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'
import { findWikilinks } from '@core/wikilinks'
import { resolveFile, resolveNote, type NoteRef } from '@core/notes'

export interface WikilinkHost {
  getIndex(): readonly NoteRef[]
  /** Open (or create, if missing) the note a wikilink points to. */
  /** `anchor` is the text after `#`, which for a PDF may name a page. */
  openTarget(target: string, anchor?: string | null): void
  /** Every file in the vault, so `[[paper.pdf]]` resolves to one. */
  getFileIndex(): readonly { path: string; stem: string }[]
}

const concealDeco = Decoration.replace({})

/**
 * Renders [[wikilinks]] Obsidian-style: brackets/heading/alias syntax conceals
 * to the label unless the cursor is inside; unresolved targets get a distinct
 * style. Regex-scanned over visible ranges — wikilinks aren't markdown, so the
 * lezer tree can't provide them.
 */
function wikilinkDecorations(host: WikilinkHost, reveal: boolean): Extension {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none
      conceals: DecorationSet = Decoration.none

      constructor(view: EditorView) {
        this.build(view)
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || (reveal && update.selectionSet)) {
          this.build(update.view)
        }
      }

      private build(view: EditorView): void {
        const { state } = view
        const index = host.getIndex()
        const all: Range<Decoration>[] = []
        const conceals: Range<Decoration>[] = []
        const touches = (from: number, to: number): boolean =>
          reveal && state.selection.ranges.some((r) => r.from <= to && r.to >= from)

        for (const { from, to } of view.visibleRanges) {
          const text = state.doc.sliceString(from, to)
          for (const link of findWikilinks(text, from)) {
            // `![[Note]]` belongs to the embed renderer: decorating the link
            // inside it would leave `![Source]` showing when the card is
            // revealed, instead of the markdown that produced it.
            if (link.embed) continue
            // A target with an extension is a file — a PDF, an image, a
            // drawing — and resolves against the file index instead. Without
            // this, `[[paper.pdf]]` draws as a broken link to a note nobody
            // meant, and clicking it would offer to create `paper.pdf.md`.
            const resolved =
              resolveNote(index, link.target) !== null ||
              (/\.[a-z0-9]+$/i.test(link.target) &&
                resolveFile(host.getFileIndex(), link.target) !== null)
            const cls = `cm-or-wikilink${resolved ? '' : ' cm-or-wikilink--missing'}`
            // `[[paper.pdf#page=12]]` names a place in a document, not only a
            // document, and the click handler cannot ask the parser again.
            const attributes = {
              'data-target': link.target,
              ...(link.heading ? { 'data-anchor': link.heading } : {})
            }
            if (touches(link.from, link.to)) {
              // Revealed: style the whole raw link, keep syntax visible.
              all.push(Decoration.mark({ class: cls, attributes }).range(link.from, link.to))
              continue
            }
            all.push(
              Decoration.mark({ class: cls, attributes }).range(link.labelFrom, link.labelTo)
            )
            const hide = (a: number, b: number): void => {
              if (a < b) {
                const deco = concealDeco.range(a, b)
                all.push(deco)
                conceals.push(deco)
              }
            }
            hide(link.from, link.labelFrom)
            hide(link.labelTo, link.to)
          }
        }

        this.decorations = Decoration.set(
          all.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide),
          false
        )
        this.conceals = Decoration.set(conceals, true)
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (p) =>
        EditorView.atomicRanges.of((view) => view.plugin(p)?.conceals ?? Decoration.none)
    }
  )

  const click = EditorView.domEventHandlers({
    click(event) {
      if (!event.ctrlKey && !event.metaKey) return false
      const target = (event.target as HTMLElement).closest?.('.cm-or-wikilink')
      if (!(target instanceof HTMLElement)) return false
      const note = target.dataset['target']
      if (!note) return false
      host.openTarget(note, target.dataset['anchor'] ?? null)
      event.preventDefault()
      return true
    }
  })

  return [plugin, click]
}

/**
 * `[[` completes note names, `#` completes tags, `/` opens the insert menu and
 * `:` completes emoji.
 *
 * Both live in one `autocompletion` config because CodeMirror's `override`
 * replaces the source list rather than adding to it — a second config would
 * silently win and the other's completions would never appear.
 */
function wikilinkCompletion(host: WikilinkHost): Extension {
  const source = (context: CompletionContext): CompletionResult | null => {
    const match = context.matchBefore(/\[\[([^\][\n]*)$/)
    if (!match) return null
    const index = host.getIndex()
    if (index.length === 0) return null
    const closed = context.state.doc.sliceString(match.to, match.to + 2) === ']]'
    return {
      from: match.from + 2,
      options: index.map((note) => ({
        label: note.stem,
        type: 'text',
        detail: note.path.split('/').slice(-2, -1)[0],
        apply: closed ? note.stem : `${note.stem}]]`
      })),
      validFor: /^[^\][\n]*$/
    }
  }
  return autocompletion({
    override: [source, tagCompletionSource, slashCompletionSource, emojiCompletionSource],
    icons: false
  })
}

export function wikilinks(host: WikilinkHost, reveal = true): Extension {
  return [wikilinkDecorations(host, reveal), wikilinkCompletion(host)]
}
