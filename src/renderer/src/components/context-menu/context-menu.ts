import { create } from 'zustand'
import type { IconName } from '../Icon'

export type MenuItem =
  | {
      label: string
      icon?: IconName
      danger?: boolean
      disabled?: boolean
      onSelect(): void
    }
  | { separator: true }

interface ContextMenuState {
  open: boolean
  x: number
  y: number
  items: MenuItem[]
}

/**
 * Custom in-app context menus (not native Electron menus) so they follow the
 * active theme and can be composed by plugins later.
 */
export const useContextMenu = create<ContextMenuState>(() => ({
  open: false,
  x: 0,
  y: 0,
  items: []
}))

export function openContextMenu(
  event: { clientX: number; clientY: number },
  items: MenuItem[]
): void {
  useContextMenu.setState({ open: true, x: event.clientX, y: event.clientY, items })
}

export function closeContextMenu(): void {
  useContextMenu.setState({ open: false, items: [] })
}
