import { resolveFile, resolveNote } from '@core/notes'
import { pageFromAnchor } from '@core/pdf-text'
import { invoke } from '@/services/client'
import type { OrreryPlugin } from '../api'
import { wikilinks } from './extension'

/**
 * Built-in plugin: [[wikilinks]] between notes — rendering, completion and
 * Mod+click navigation. Clicking a link to a note that doesn't exist yet
 * creates it in the workspace root (Obsidian behavior) — notes come cheap
 * in a knowledge base.
 */
export const wikilinksPlugin: OrreryPlugin = {
  id: 'wikilinks',
  name: 'Wikilinks',
  activate(ctx) {
    const host = {
      getIndex: () => ctx.store.getState().noteIndex,
      getFileIndex: () => ctx.store.getState().fileIndex,
      openTarget: (target: string, anchor?: string | null): void => {
        const state = ctx.store.getState()
        const existing = resolveNote(state.noteIndex, target)
        if (existing) {
          void state.openPaths([existing.path])
          return
        }
        // A target that names a file — `[[paper.pdf]]`, `[[diagram.excalidraw]]`
        // — opens that file rather than minting a note beside it. For a PDF the
        // anchor may name a page: `[[paper.pdf#page=12]]` is the fragment every
        // PDF viewer already understands, and it opens there.
        const file = /\.[a-z0-9]+$/i.test(target) ? resolveFile(state.fileIndex, target) : null
        if (file) {
          const page = /\.pdf$/i.test(file.path) ? pageFromAnchor(anchor ?? null) : null
          if (page) state.openPdfAt(file.path, page)
          else void state.openPaths([file.path])
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
