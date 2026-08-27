import type { Extension } from '@codemirror/state'
import type { Settings } from '@shared/settings'
import type { Command } from '@/commands/registry'
import type { useStore } from '@/state/store'

/**
 * The surface a orrery plugin programs against. Kept deliberately narrow and
 * versioned by addition only — the same contract will back external/community
 * modules and AI capabilities later; built-ins prove it today.
 */
export interface PluginContext {
  /** Add commands to the app-wide registry (menus, shortcuts, palette). */
  registerCommand(command: Command): void
  /**
   * Contribute a CodeMirror extension to every document editor. The factory
   * re-runs whenever settings change, so plugins can react to preferences.
   */
  addEditorExtension(factory: (settings: Settings) => Extension): void
  /** Read app state and dispatch actions. */
  store: typeof useStore
}

export interface OrreryPlugin {
  /** Unique id, kebab-case (e.g. 'wikilinks'). */
  id: string
  name: string
  activate(ctx: PluginContext): void
}
