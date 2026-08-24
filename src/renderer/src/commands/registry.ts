import type { EditorView } from '@codemirror/view'
import type { AppState } from '@/state/store'

export interface CommandContext {
  store: () => AppState
  view: () => EditorView | null
}

export interface Command {
  id: string
  /** Human label — used by menus today, the command palette tomorrow. */
  title: string
  run(ctx: CommandContext): void | Promise<void>
}

/**
 * Command pattern: menus, keyboard shortcuts and any future palette are just
 * dispatchers over this one behavior table.
 */
export function createCommandRegistry(ctx: CommandContext) {
  const commands = new Map<string, Command>()

  return {
    register(...items: Command[]): void {
      for (const command of items) {
        if (commands.has(command.id)) {
          throw new Error(`Command already registered: ${command.id}`)
        }
        commands.set(command.id, command)
      }
    },
    execute(id: string): void {
      const command = commands.get(id)
      if (!command) {
        console.warn(`Unknown command: ${id}`)
        return
      }
      void command.run(ctx)
    },
    getAll(): Command[] {
      return [...commands.values()]
    }
  }
}

export type CommandRegistry = ReturnType<typeof createCommandRegistry>
