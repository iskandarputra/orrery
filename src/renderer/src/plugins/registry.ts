import type { Extension } from '@codemirror/state'
import type { Settings } from '@shared/settings'
import type { DocumentSurface, PluginContext, OrreryPlugin } from './api'

/**
 * Holds plugin contributions. Standalone module (imports no app state) so the
 * editor factory can pull plugin extensions without dependency cycles.
 */
const editorExtensionFactories: ((settings: Settings) => Extension)[] = []
const activePlugins: OrreryPlugin[] = []
const documentSurfaces: DocumentSurface[] = []

export function activatePlugins(
  plugins: OrreryPlugin[],
  ctx: Omit<PluginContext, 'addEditorExtension' | 'registerDocumentSurface'>
): void {
  const fullCtx: PluginContext = {
    ...ctx,
    addEditorExtension: (factory) => editorExtensionFactories.push(factory),
    registerDocumentSurface: (surface) => {
      // First registration wins. Two surfaces claiming one extension is a
      // conflict the user cannot see and cannot resolve, so it is reported
      // rather than silently decided by activation order.
      const clash = documentSurfaces.find((s) => s.id === surface.id)
      if (clash) {
        console.warn(`Document surface already registered: ${surface.id}`)
        return
      }
      documentSurfaces.push(surface)
    }
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

/** Every registered surface, for building commands and menus from them. */
export function allDocumentSurfaces(): readonly DocumentSurface[] {
  return documentSurfaces
}

/** The surface that claims this file, if any. Consulted before `documentKind`. */
export function surfaceForFile(fileName: string): DocumentSurface | null {
  return documentSurfaces.find((s) => s.claims(fileName)) ?? null
}

/** The surface a buffer's kind names, if that kind came from a surface. */
export function surfaceForKind(kind: string): DocumentSurface | null {
  return documentSurfaces.find((s) => s.id === kind) ?? null
}
