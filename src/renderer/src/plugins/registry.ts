import type { Extension } from '@codemirror/state'
import type { Settings } from '@shared/settings'
import type { PluginContext, OrreryPlugin } from './api'

/**
 * Holds plugin contributions. Standalone module (imports no app state) so the
 * editor factory can pull plugin extensions without dependency cycles.
 */
const editorExtensionFactories: ((settings: Settings) => Extension)[] = []
const activePlugins: OrreryPlugin[] = []

export function activatePlugins(
  plugins: OrreryPlugin[],
  ctx: Omit<PluginContext, 'addEditorExtension'>
): void {
  const fullCtx: PluginContext = {
    ...ctx,
    addEditorExtension: (factory) => editorExtensionFactories.push(factory)
  }
  for (const plugin of plugins) {
    if (activePlugins.some((p) => p.id === plugin.id)) {
      console.warn(`Plugin already active: ${plugin.id}`)
      continue
    }
    try {
      plugin.activate(fullCtx)
      activePlugins.push(plugin)
    } catch (err) {
      console.error(`Failed to activate plugin ${plugin.id}:`, err)
    }
  }
}

/** Editor extensions contributed by plugins, evaluated for current settings. */
export function pluginEditorExtensions(settings: Settings): Extension[] {
  return editorExtensionFactories.map((factory) => factory(settings))
}

export function getActivePlugins(): readonly OrreryPlugin[] {
  return activePlugins
}
