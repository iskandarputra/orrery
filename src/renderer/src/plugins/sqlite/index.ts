import type { OrreryPlugin } from '../api'
import { DbViewer } from './DbViewer'

/**
 * SQLite files, opened as what they are.
 *
 * A built-in written against the public surface API, like the CSV table and the
 * drawing board, and the first one to declare itself binary: a database read as
 * text would be megabytes of B-tree decoded as UTF-8.
 */
export const sqlitePlugin: OrreryPlugin = {
  id: 'sqlite',
  name: 'Database',
  activate(ctx) {
    ctx.registerDocumentSurface({
      id: 'sqlite',
      label: 'SQLite',
      claims: (fileName) => /\.(db|sqlite|sqlite3|db3)$/i.test(fileName),
      binary: true,
      Component: DbViewer
    })
  }
}
