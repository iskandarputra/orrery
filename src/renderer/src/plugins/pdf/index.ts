import type { OrreryPlugin } from '../api'
import { PdfViewer } from './PdfViewer'
import { redoPdf, savePdf, undoPdf } from './saving'

/**
 * PDFs as a document kind.
 *
 * The file type a knowledge base most often cannot see into: papers, manuals,
 * contracts and scans. Read as text a PDF is a page tree and a pile of
 * compressed streams, so it opens on a surface of its own — the same seam
 * Excalidraw and the database viewer use.
 */
export const pdfPlugin: OrreryPlugin = {
  id: 'pdf',
  name: 'PDF',
  activate(ctx) {
    ctx.registerDocumentSurface({
      id: 'pdf',
      label: 'PDF',
      claims: (fileName) => /\.pdf$/i.test(fileName),
      Component: PdfViewer,
      // Never decoded as text: a hundred-megabyte scan read as UTF-8 is a
      // hundred megabytes of nonsense held in memory for nothing.
      binary: true,
      // And because the buffer is empty, the ordinary save would write nothing
      // over the file. The open reader holds the annotations and the form
      // values, so it is the thing that saves.
      save: savePdf,
      // Ctrl+Z belongs to the editor when a note is open; this document is not
      // text, so the surface is asked instead.
      undo: undoPdf,
      redo: redoPdf
    })
  }
}
