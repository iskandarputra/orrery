import type { Extension } from '@codemirror/state'
import type { DocumentKind } from '@core/document-kind'
import type { Settings } from '@shared/settings'
import type { Command } from '@/commands/registry'
import type { useStore } from '@/state/store'

/**
 * The surface a orrery plugin programs against. Kept deliberately narrow and
 * versioned by addition only — the same contract will back external/community
 * modules and AI capabilities later; built-ins prove it today.
 */
/**
 * A whole editing surface for a kind of file the text editor cannot show.
 *
 * The seam that makes a third-party editor a first-class file type rather than
 * something bolted beside one. A surface claims files by name, is rendered in
 * place of the editor, and reads and writes the buffer's document like any
 * other view of it — so dirty state, saving, undo and reload-from-disk are the
 * app's own and not reimplemented per surface.
 */
export interface DocumentSurface {
  /** Stable id, kebab-case. Becomes the DocumentKind of the files it claims. */
  id: string
  /** Shown where a text document would report its language. */
  label: string
  /**
   * Whether this surface owns the file. Consulted before the built-in
   * classification, so a surface can claim an extension that would otherwise
   * be read as code — which is the point of registering one.
   */
  claims(fileName: string): boolean
  /**
   * Rendered instead of the text editor. Given only the buffer id: everything
   * else it needs, including the document, it reads through the app's own
   * state, the same way the built-in surfaces do.
   */
  Component: (props: { bufferId: string }) => React.JSX.Element
}

export interface PluginContext {
  /** Add commands to the app-wide registry (menus, shortcuts, palette). */
  registerCommand(command: Command): void
  /**
   * Contribute a CodeMirror extension to every document editor. The factory
   * re-runs whenever settings change, so plugins can react to preferences.
   */
  addEditorExtension(factory: (settings: Settings) => Extension): void
  /**
   * Contribute an editing surface for a kind of file, making it a first-class
   * document rather than text the editor would misread.
   */
  registerDocumentSurface(surface: DocumentSurface): void
  /** Read app state and dispatch actions. */
  store: typeof useStore
}

export type { DocumentKind }

export interface OrreryPlugin {
  /** Unique id, kebab-case (e.g. 'wikilinks'). */
  id: string
  name: string
  activate(ctx: PluginContext): void
}
