import { EditorView } from '@codemirror/view'
import type { Extension } from '@codemirror/state'
import { TREE_DRAG_TYPE } from '@core/tree-actions'
import { appState } from '@/state/app-state-access'
import { invoke, parseIpcError } from '@/services/client'
import { assetFileName, assetMarkdown } from './assets'

/** Read a File as base64, without the data-URL prefix. */
async function toBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer()
  let binary = ''
  const bytes = new Uint8Array(buffer)
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]!)
  return btoa(binary)
}

/** Save one image into the vault and return the markdown that embeds it. */
async function fileAsset(file: File): Promise<string | null> {
  const { rootPath, settings, showToast } = appState()
  if (!rootPath) {
    showToast('Open a folder before adding images', 'warning')
    return null
  }
  try {
    const { path } = await invoke('fs:writeAsset', {
      dirPath: `${rootPath}/${settings.markdown.assetFolder || 'assets'}`,
      name: assetFileName(file.name, Date.now()),
      base64: await toBase64(file)
    })
    void appState().refreshTree()
    return assetMarkdown(path, rootPath)
  } catch (err) {
    showToast(parseIpcError(err).message, 'error')
    return null
  }
}

/** Insert text at the current selection as one undoable step. */
function insert(view: EditorView, text: string): void {
  const { from, to } = view.state.selection.main
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length }
  })
}

async function handleFiles(view: EditorView, files: File[]): Promise<void> {
  const images = files.filter((f) => f.type.startsWith('image/'))
  if (images.length === 0) return
  const links: string[] = []
  for (const image of images) {
    const markdown = await fileAsset(image)
    if (markdown) links.push(markdown)
  }
  if (links.length > 0) {
    insert(view, links.join('\n'))
    view.focus()
  }
}

/** The vault paths a tree drag is carrying, if that is what this drag is. */
function draggedRows(event: DragEvent): string[] {
  if (!event.dataTransfer?.types.includes(TREE_DRAG_TYPE)) return []
  return event.dataTransfer.getData(TREE_DRAG_TYPE).split('\n').filter(Boolean)
}

/**
 * Paste or drop an image into a note: the file is copied into the vault's asset
 * folder and an embed is written at the cursor. Without this, a screenshot in
 * the clipboard has nowhere to go — the single most common way notes get
 * pictures.
 *
 * Markdown files that are dropped are opened as tabs instead; dropping a note
 * onto the editor means "open this", not "paste a copy of it". A row dragged
 * out of the file tree means the same thing. It carries its paths under
 * `TREE_DRAG_TYPE` rather than as text, so the editor opens them: dropped as
 * text the note would be refused the drop entirely, and the gesture would do
 * nothing at all.
 */
export function pasteAssets(): Extension {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const files = [...(event.clipboardData?.files ?? [])]
      if (!files.some((f) => f.type.startsWith('image/'))) return false
      event.preventDefault()
      void handleFiles(view, files)
      return true
    },
    dragover(event) {
      if (event.dataTransfer?.types.includes(TREE_DRAG_TYPE)) {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        return true
      }
      if (!event.dataTransfer?.types.includes('Files')) return false
      // Without this the OS shows "no drop allowed" over the editor.
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      return true
    },
    drop(event, view) {
      const rows = draggedRows(event)
      if (rows.length > 0) {
        event.preventDefault()
        void appState().openPaths(rows)
        return true
      }
      const files = [...(event.dataTransfer?.files ?? [])]
      if (files.length === 0) return false
      event.preventDefault()

      const notes = files.filter((f) => /\.(md|markdown|mdown|mkd)$/i.test(f.name))
      for (const note of notes) {
        const dropped = note as File & { path?: string }
        if (dropped.path) void appState().openPaths([dropped.path])
      }
      void handleFiles(view, files)
      return true
    }
  })
}
