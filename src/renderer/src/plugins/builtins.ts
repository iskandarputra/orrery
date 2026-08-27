import type { OrreryPlugin } from './api'
import { wikilinksPlugin } from './wikilinks'

/**
 * Plugins shipped with orrery. External/community module loading will feed the
 * same activation path.
 */
export const builtinPlugins: OrreryPlugin[] = [wikilinksPlugin]
