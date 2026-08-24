import type { ZymdPlugin } from './api'
import { wikilinksPlugin } from './wikilinks'

/**
 * Plugins shipped with zymd. External/community module loading will feed the
 * same activation path.
 */
export const builtinPlugins: ZymdPlugin[] = [wikilinksPlugin]
