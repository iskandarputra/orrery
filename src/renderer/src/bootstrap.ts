import { builtinCommands } from './commands/builtins'
import { openContextMenu } from './components/context-menu/context-menu'
import { buildEditorMenu } from './components/editor-menu'
import { editorMenuActions } from './components/editor-menu-actions'
import { createCommandRegistry, type CommandRegistry } from './commands/registry'
import { getActiveView } from './editor/active-view'
import { routeDiagnostics } from './editor/lsp-session'
import type { OrreryPlugin } from './plugins/api'
import { builtinPlugins } from './plugins/builtins'
import { activatePlugins } from './plugins/registry'
import { surfaceCreateCommands } from './plugins/surface-commands'
import { invoke, on } from './services/client'
import { startTooltips } from './services/tooltips'
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
  // After activation, not during: a surface's create command is derived from
  // what it registered, so the registry has to be populated first.
  for (const command of surfaceCreateCommands()) registry.register(command)

  // User plugins: <userData>/plugins/*.js — each calls orrery.register({...}).
  // Trusted local code, same model as Obsidian community plugins.
  void invoke('plugins:list', undefined).then((files) => {
    for (const file of files) {
      try {
        const plugins: OrreryPlugin[] = []
        new Function('orrery', file.source)({
          register: (p: OrreryPlugin) => plugins.push(p)
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

  // Every labelled control gets a tooltip that appears when you look at it
  // rather than a second later; the operating system's own delay cannot be
  // shortened from a page.
  startTooltips()

  on('menu:command', ({ commandId }) => registry.execute(commandId))
  on('window:closeRequested', () => void useStore.getState().handleWindowCloseRequest())
  on('fs:changed', ({ events }) => useStore.getState().onFsChanged(events))
  // Diagnostics arrive whenever a server has something to say, for whatever
  // file it pleases — including one in a background tab, which is why they
  // are routed by path rather than applied to whatever is on screen.
  on('lsp:diagnostics', (payload) => routeDiagnostics(payload))
  on('app:openPath', ({ path }) => void useStore.getState().openPaths([path]))
  on('app:openFolder', ({ path }) => void useStore.getState().openFolder(path))
  // MCP servers announce themselves as they connect, and main asks permission
  // through the same channel a tool call is waiting on.
  on('mcp:serverChanged', (status) => useStore.getState().onMcpServerChanged(status))
  on('mcp:ask', (request) => useStore.getState().onMcpAsk(request))
  on('mcp:activity', () => void useStore.getState().refreshMcpLog())
  on('editor:contextMenu', (request) => {
    // The tab bar and file tree open their own menus on the DOM event; this
    // one is the fallback for everywhere else, which in practice is the editor.
    if ((document.activeElement as HTMLElement | null)?.closest('.tree-row, .tab')) return
    openContextMenu(
      { clientX: request.x, clientY: request.y },
      buildEditorMenu(request, editorMenuActions())
    )
  })

  void useStore
    .getState()
    .loadSettings()
    .then(() => {
      const { lastOpenedFolder, general, session } = useStore.getState().settings
      if (!lastOpenedFolder || !general.restoreLastFolder) return
      useStore
        .getState()
        .openFolder(lastOpenedFolder)
        .then(async () => {
          // Reopen last session's tabs. Files deleted since are skipped by
          // openPaths, so a stale entry costs a warning, not a failure.
          if (session.openPaths.length === 0) return
          await useStore.getState().openPaths(session.openPaths)
          const active = Object.values(useStore.getState().buffers).find(
            (b) => b.filePath === session.activePath
          )
          if (active) useStore.getState().setActive(active.id)
        })
        .catch(() => useStore.getState().updateSettings({ lastOpenedFolder: null }))
    })

  return registry
}
