import type { OrreryPlugin } from '../api'
import { ExcalidrawEditor } from './ExcalidrawEditor'

/**
 * Excalidraw drawings as a document kind.
 *
 * A built-in that uses nothing a community plugin could not: it claims an
 * extension and hands back a component. If this can be a plugin, so can a
 * diagram editor, a PDF viewer, or a notebook.
 */
export const excalidrawPlugin: OrreryPlugin = {
  id: 'excalidraw',
  name: 'Excalidraw',
  activate(ctx) {
    ctx.registerDocumentSurface({
      id: 'excalidraw',
      label: 'Excalidraw',
      // The format Excalidraw itself reads and writes, so a board made here
      // opens on excalidraw.com and one made there opens here.
      claims: (fileName) => /\.excalidraw$/i.test(fileName),
      Component: ExcalidrawEditor
    })
  }
}
