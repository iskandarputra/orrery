import type { OrreryPlugin } from './api'
import { csvPlugin } from './csv'
import { sqlitePlugin } from './sqlite'
import { excalidrawPlugin } from './excalidraw'
import { pdfPlugin } from './pdf'
import { wikilinksPlugin } from './wikilinks'

/**
 * Plugins shipped with orrery. External/community module loading will feed the
 * same activation path.
 */
export const builtinPlugins: OrreryPlugin[] = [
  wikilinksPlugin,
  excalidrawPlugin,
  csvPlugin,
  sqlitePlugin,
  pdfPlugin
]
