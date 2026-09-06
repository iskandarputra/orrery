import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { appState } from '@/state/app-state-access'
import { languages } from '@codemirror/language-data'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { resolveFile, resolveNote } from '@core/notes'
import { pageFromAnchor } from '@core/pdf-text'
import { wikilinks } from '@/plugins/wikilinks/extension'
import { HighlightExtension } from './markdown/highlight-extension'
import { composeLivePreview } from './live-preview/compose'
import { orreryEditorTheme } from './theme'

/**
 * A read-only rendered view of some markdown, for places that show a note
 * rather than edit it: canvas cards, note embeds, previews.
 *
 * It reuses the editor's own live preview in Reading mode instead of adding a
 * second markdown renderer — so a heading, a bold run or a code fence looks the
 * same wherever it appears, and there is one implementation to keep correct.
 *
 * `sourcePath` is not the active editor tab: a preview shows somebody else's
 * note, and a `[[link]]` written inside it belongs to that note, not to
 * whatever tab happens to be focused. Getting this wrong ranks a link in an
 * embedded note against the wrong home folder, which can resolve to a
 * different file than the graph draws its edge to.
 */
export function mountPreview(parent: HTMLElement, text: string, sourcePath: string): EditorView {
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
        composeLivePreview({ reveal: false }),
        // Wikilinks render here too: an embedded note showing `[[Other]]` as
        // raw brackets would look unfinished beside the same note in the editor.
        wikilinks(
          {
            getIndex: () => appState().noteIndex,
            getFileIndex: () => appState().fileIndex,
            getFromPath: () => sourcePath,
            openTarget: (target, anchor) => {
              const state = appState()
              const note = resolveNote(state.noteIndex, target, sourcePath)
              if (note) {
                void state.openPaths([note.path])
                return
              }
              const file = resolveFile(state.fileIndex, target, sourcePath)
              if (!file) return
              const page = /\.pdf$/i.test(file.path) ? pageFromAnchor(anchor ?? null) : null
              if (page) state.openPdfAt(file.path, page)
              else void state.openPaths([file.path])
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
