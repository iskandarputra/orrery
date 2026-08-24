import { builtinCommands } from './commands/builtins'
import { createCommandRegistry, type CommandRegistry } from './commands/registry'
import { getActiveView } from './editor/active-view'
import type { ZymdPlugin } from './plugins/api'
import { builtinPlugins } from './plugins/builtins'
import { activatePlugins } from './plugins/registry'
import { invoke, on } from './services/client'
import { useStore } from './state/store'

/**
 * Wires the app together once at startup: command registry, main-process
 * event subscriptions, settings load and workspace restore.
 */
let globalRegistry: CommandRegistry | null = null

/** The app's command registry (set once by bootstrap; used by the palette). */
export function getRegistry(): CommandRegistry | null {
  return globalRegistry
}

export function bootstrap(): CommandRegistry {
  const registry = createCommandRegistry({
    store: () => useStore.getState(),
    view: () => getActiveView()
  })
  registry.register(...builtinCommands)
  globalRegistry = registry

  activatePlugins(builtinPlugins, {
    registerCommand: (command) => registry.register(command),
    store: useStore
  })

  // User plugins: <userData>/plugins/*.js — each calls zymd.register({...}).
  // Trusted local code, same model as Obsidian community plugins.
  void invoke('plugins:list', undefined).then((files) => {
    for (const file of files) {
      try {
        const plugins: ZymdPlugin[] = []
        new Function('zymd', file.source)({
          register: (p: ZymdPlugin) => plugins.push(p)
        })
        activatePlugins(plugins, {
          registerCommand: (command) => registry.register(command),
          store: useStore
        })
        if (plugins.length) console.info(`Loaded plugin ${file.name}`)
      } catch (err) {
        console.error(`Plugin ${file.name} failed:`, err)
      }
    }
  })

  on('menu:command', ({ commandId }) => registry.execute(commandId))
  on('window:closeRequested', () => void useStore.getState().handleWindowCloseRequest())
  on('fs:changed', ({ events }) => useStore.getState().onFsChanged(events))
  on('app:openPath', ({ path }) => void useStore.getState().openPaths([path]))

  void useStore
    .getState()
    .loadSettings()
    .then(() => {
      const { lastOpenedFolder, general } = useStore.getState().settings
      if (lastOpenedFolder && general.restoreLastFolder) {
        useStore
          .getState()
          .openFolder(lastOpenedFolder)
          .catch(() => useStore.getState().updateSettings({ lastOpenedFolder: null }))
      }
    })

  return registry
}
