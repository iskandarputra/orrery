import { useEffect, useRef } from 'react'
import type { EditorView } from '@codemirror/view'
import { mountPreview, updatePreview } from '@/editor/preview-view'

/**
 * Read-only rendered markdown, for canvas cards. The rendering itself is the
 * editor's own live preview — see `mountPreview`.
 */
export function MarkdownCard({ text }: { text: string }): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)

  useEffect(() => {
    // A card's text is not a file: there is nothing for a link inside it to
    // rank against, so it falls back to the same "no file" convention
    // `activeFilePath` uses elsewhere.
    const view = mountPreview(hostRef.current!, text, '')
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // Built once per card; text changes are pushed below rather than remounting.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (viewRef.current) updatePreview(viewRef.current, text)
  }, [text])

  return <div ref={hostRef} className="canvas__card-markdown" />
}
