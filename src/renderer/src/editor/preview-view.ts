import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { resolveNote } from '@core/notes'
import { wikilinks } from '@/plugins/wikilinks/extension'
import { useStore } from '@/state/store'
import { HighlightExtension } from './markdown/highlight-extension'
import { livePreview } from './live-preview'
import { orreryEditorTheme } from './theme'

/**
 * A read-only rendered view of some markdown, for places that show a note
 * rather than edit it: canvas cards, note embeds, previews.
 *
 * It reuses the editor's own live preview in Reading mode instead of adding a
 * second markdown renderer — so a heading, a bold run or a code fence looks the
 * same wherever it appears, and there is one implementation to keep correct.
 */
export function mountPreview(parent: HTMLElement, text: string): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc: text,
      extensions: [
        markdown({
          base: markdownLanguage,
          codeLanguages: languages,
          extensions: [HighlightExtension]
        }),
        orreryEditorTheme(),
        EditorView.lineWrapping,
        livePreview({ reveal: false }),
        // Wikilinks render here too: an embedded note showing `[[Other]]` as
        // raw brackets would look unfinished beside the same note in the editor.
        wikilinks(
          {
            getIndex: () => useStore.getState().noteIndex,
            openTarget: (target) => {
              const state = useStore.getState()
              const note = resolveNote(state.noteIndex, target)
              if (note) void state.openPaths([note.path])
            }
          },
          false
        ),
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        // CodeMirror marks its content as a textbox. Here the content is
        // rendered prose, and it sits inside the host editor's own textbox —
        // nested textboxes are invalid ARIA and make one note announce as
        // several text boxes. An embedded note is self-contained content.
        EditorView.contentAttributes.of({ role: 'article' })
      ]
    }),
    parent
  })
}

/** Push new text into a mounted preview without rebuilding it. */
export function updatePreview(view: EditorView, text: string): void {
  if (view.state.doc.toString() === text) return
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
}
