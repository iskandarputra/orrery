import { useEffect, useRef } from 'react'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { HighlightExtension } from '@/editor/markdown/highlight-extension'
import { livePreview } from '@/editor/live-preview'
import { zymdEditorTheme } from '@/editor/theme'

/**
 * Read-only rendered markdown, for canvas cards.
 *
 * Reuses the editor's own live preview in Reading mode rather than introducing
 * a second markdown renderer: headings, emphasis, code, tables and callouts
 * then look exactly as they do in a note, and there is one implementation to
 * keep correct. The card's text is still edited as plain markdown — this only
 * renders it while the card is idle.
 */
export function MarkdownCard({ text }: { text: string }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    const view = new EditorView({
      state: EditorState.create({
        doc: text,
        extensions: [
          markdown({
            base: markdownLanguage,
            codeLanguages: languages,
            extensions: [HighlightExtension]
          }),
          zymdEditorTheme(),
          EditorView.lineWrapping,
          livePreview({ reveal: false }),
          EditorView.editable.of(false),
          EditorState.readOnly.of(true)
        ]
      }),
      parent: hostRef.current!
    })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Built once per card; text changes are pushed below rather than remounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const view = viewRef.current
    if (!view || view.state.doc.toString() === text) return
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
  }, [text])

  return <div ref={hostRef} className="canvas__card-markdown" />
}
