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
      Component: ExcalidrawEditor,
      create: {
        label: 'New drawing',
        baseName: 'Drawing',
        extension: 'excalidraw',
        // The empty scene Excalidraw itself writes. `elements: []` alone would
        // load, but a file without the envelope is not one excalidraw.com will
        // open, and the format working in both directions is the whole point.
        template: `${JSON.stringify(
          {
            type: 'excalidraw',
            version: 2,
            source: 'orrery',
            elements: [],
            appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
            files: {}
          },
          null,
          2
        )}\n`
      }
    })
  }
}
