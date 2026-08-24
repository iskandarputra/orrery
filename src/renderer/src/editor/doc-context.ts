import { Facet } from '@codemirror/state'

/**
 * The filesystem path of the document in an EditorState — lets editor
 * extensions (e.g. image rendering) resolve relative asset paths. Null for
 * untitled buffers.
 */
export const docPathFacet = Facet.define<string | null, string | null>({
  combine: (values) => values[0] ?? null
})
