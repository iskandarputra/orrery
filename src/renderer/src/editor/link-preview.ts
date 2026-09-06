import type { Extension } from '@codemirror/state'
import { hoverTooltip, type EditorView, type Tooltip } from '@codemirror/view'
import { resolveNote } from '@core/notes'
import { findWikilinks } from '@core/wikilinks'
import { invoke } from '@/services/client'
import { activeFilePath } from '@/state/app-state'
import { appState } from '@/state/app-state-access'
import { mountPreview } from './preview-view'

/**
 * The note behind a link, without opening it.
 *
 * Following a wikilink to check what is in it, then coming back, is the most
 * common navigation there is and the most disruptive: it costs a tab, the
 * scroll position, and the thread of what you were writing. Hovering answers
 * the question in place.
 *
 * Rendered with `mountPreview`, the same reader the embed cards use, so a
 * heading or a code fence looks the way it does everywhere else.
 */

/** How much of the note to show. Enough to recognise it, not to read it. */
const MAX_CHARS = 1200

/** The wikilink under a position, if there is one. */
function linkAt(view: EditorView, pos: number): string | null {
  const line = view.state.doc.lineAt(pos)
  for (const link of findWikilinks(line.text, line.from)) {
    if (pos >= link.from && pos <= link.to) return link.target
  }
  return null
}

export function linkPreview(): Extension {
  return hoverTooltip(
    async (view: EditorView, pos: number): Promise<Tooltip | null> => {
      const target = linkAt(view, pos)
      if (!target) return null

      const state = appState()
      const note = resolveNote(state.noteIndex, target, activeFilePath(state))
      // A link to a note that does not exist has nothing to preview, and the
      // dashed styling already says so.
      if (!note) return null

      let content: string
      try {
        content = (await invoke('fs:readFile', { path: note.path })).content
      } catch {
        return null
      }

      return {
        pos,
        above: true,
        create: () => {
          const dom = document.createElement('div')
          dom.className = 'cm-or-link-preview'

          const title = document.createElement('div')
          title.className = 'cm-or-link-preview__title'
          title.textContent = note.stem
          dom.append(title)

          const body = document.createElement('div')
          body.className = 'cm-or-link-preview__body'
          dom.append(body)

          const shown = content.length > MAX_CHARS ? `${content.slice(0, MAX_CHARS)}\n\n…` : content
          const preview = mountPreview(body, shown, note.path)

          // Destroyed with the tooltip: a preview per hover, left mounted, is a
          // detached editor per link the pointer crossed on its way somewhere.
          return { dom, destroy: () => preview.destroy() }
        }
      }
    },
    // Long enough that crossing a paragraph of links reads none of them.
    { hoverTime: 450 }
  )
}
