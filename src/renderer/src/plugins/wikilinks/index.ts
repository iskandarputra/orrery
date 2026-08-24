import { resolveNote } from '@core/notes'
import { invoke } from '@/services/client'
import type { ZymdPlugin } from '../api'
import { wikilinks } from './extension'

/**
 * Built-in plugin: [[wikilinks]] between notes — rendering, completion and
 * Mod+click navigation. Clicking a link to a note that doesn't exist yet
 * creates it in the workspace root (Obsidian behavior) — notes come cheap
 * in a knowledge base.
 */
export const wikilinksPlugin: ZymdPlugin = {
  id: 'wikilinks',
  name: 'Wikilinks',
  activate(ctx) {
    const host = {
      getIndex: () => ctx.store.getState().noteIndex,
      openTarget: (target: string): void => {
        const state = ctx.store.getState()
        const existing = resolveNote(state.noteIndex, target)
        if (existing) {
          void state.openPaths([existing.path])
          return
        }
        const root = state.rootPath
        if (!root) return
        void invoke('fs:createFile', { dirPath: root, name: `${target}.md` })
          .then(async (node) => {
            await state.refreshTree()
            await state.openPaths([node.path])
          })
          .catch((err) => console.error('Could not create linked note:', err))
      }
    }
    // Reading mode renders statically: don't reveal raw [[…]] on click.
    ctx.addEditorExtension((settings) => wikilinks(host, settings.editor.viewMode !== 'reading'))
  }
}
