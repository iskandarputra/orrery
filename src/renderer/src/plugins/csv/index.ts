import type { OrreryPlugin } from '../api'
import { CsvEditor } from './CsvEditor'

/**
 * CSV as a table rather than a wall of commas.
 *
 * Another built-in written against the public surface API, using only what a
 * third-party plugin can reach.
 */
export const csvPlugin: OrreryPlugin = {
  id: 'csv',
  name: 'CSV',
  activate(ctx) {
    ctx.registerDocumentSurface({
      id: 'csv',
      label: 'CSV',
      claims: (fileName) => /\.(csv|tsv)$/i.test(fileName),
      Component: CsvEditor,
      create: {
        label: 'New table',
        baseName: 'Table',
        extension: 'csv',
        template: 'name,value\n,\n'
      }
    })
  }
}
