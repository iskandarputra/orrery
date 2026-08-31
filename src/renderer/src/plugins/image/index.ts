import type { OrreryPlugin } from '../api'
import { ImageViewer } from './ImageViewer'

/**
 * Pictures as a document kind.
 *
 * Every format the renderer can draw without help — which is to say, whatever
 * Chromium decodes. The list is deliberate rather than "anything that is not
 * text": a file type nobody can display should say so in the tree, not open a
 * blank frame.
 *
 * SVG is missing on purpose. It is a picture, but it is also a text file
 * somebody may want to edit, and there is nowhere in this app to say "open
 * that one as text instead" — so claiming it would quietly take away the only
 * way to change one. It still renders inside notes and in the media viewer.
 */
const IMAGES = /\.(png|jpe?g|gif|webp|bmp|avif|ico)$/i

export const imagePlugin: OrreryPlugin = {
  id: 'image',
  name: 'Images',
  activate(ctx) {
    ctx.registerDocumentSurface({
      id: 'image',
      label: 'Image',
      claims: (fileName) => IMAGES.test(fileName),
      Component: ImageViewer,
      // Never read as text. Before this a PNG opened as its own bytes decoded
      // as UTF-8 — a screenful of replacement characters, and one Ctrl+S away
      // from writing that back over the picture.
      binary: true
    })
  }
}
