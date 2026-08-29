import type { Command } from '@/commands/registry'
import { appState } from '@/state/app-state-access'
import { createInVault } from '@/notes/canvas-commands'
import { allDocumentSurfaces } from './registry'

/**
 * A "new file" command for every surface that says how to make one.
 *
 * Built from the registry rather than written per surface, so a plugin reaches
 * the palette and the menus by describing its format — not by knowing anything
 * about how commands are registered.
 */
export function surfaceCreateCommands(): Command[] {
  return allDocumentSurfaces().flatMap((surface) => {
    const create = surface.create
    if (!create) return []
    return [
      {
        id: `file.new.${surface.id}`,
        title: create.label,
        run: async () => {
          const path = await createInVault(create.baseName, create.extension, create.template)
          if (!path) return
          const store = appState()
          void store.refreshTree()
          await store.openPaths([path])
        }
      }
    ]
  })
}
