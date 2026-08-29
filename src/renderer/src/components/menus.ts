import type { FileNode } from '@shared/types'
import { appState } from '@/state/app-state-access'
import { invoke } from '@/services/client'
import type { MenuItem } from './context-menu/context-menu'
import { closeBuffersUnder, editNameOf } from './TreeEditInput'

/** Context menu for a tab. */
export function buildTabMenu(bufferId: string): MenuItem[] {
  const state = appState()
  const buffer = state.buffers[bufferId]
  if (!buffer) return []
  const order = state.tabOrder
  const idx = order.indexOf(bufferId)

  return [
    { label: 'Close', icon: 'x', onSelect: () => void state.closeTab(bufferId) },
    {
      label: 'Close Others',
      disabled: order.length < 2,
      onSelect: () => void state.closeOthers(bufferId)
    },
    {
      label: 'Close to the Right',
      disabled: idx === order.length - 1,
      onSelect: () => void state.closeToRight(bufferId)
    },
    { label: 'Close All', onSelect: () => void state.closeAllTabs() },
    { separator: true },
    {
      label: 'Copy Path',
      disabled: !buffer.filePath,
      onSelect: () => void navigator.clipboard.writeText(buffer.filePath ?? '')
    },
    {
      label: 'Reveal in File Manager',
      icon: 'folder-open',
      disabled: !buffer.filePath,
      onSelect: () => void invoke('shell:showItemInFolder', { path: buffer.filePath! })
    }
  ]
}

/** Context menu for a file-tree node. */
export function buildTreeMenu(node: FileNode): MenuItem[] {
  const state = appState()
  const isDir = node.kind === 'directory'

  const shared: MenuItem[] = [
    {
      label: 'Rename',
      icon: 'type',
      onSelect: () =>
        state.setTreeEdit({ type: 'rename', path: node.path, ...editNameOf(node.path) })
    },
    {
      label: 'Delete',
      icon: 'x',
      danger: true,
      onSelect: () => {
        if (window.confirm(`Move "${node.name}" to trash?`)) {
          void invoke('fs:trash', { path: node.path }).then(() => {
            closeBuffersUnder(node.path)
            void state.refreshTree()
          })
        }
      }
    },
    { separator: true },
    {
      label: 'Copy Path',
      onSelect: () => void navigator.clipboard.writeText(node.path)
    },
    {
      label: 'Reveal in File Manager',
      icon: 'folder-open',
      onSelect: () => void invoke('shell:showItemInFolder', { path: node.path })
    }
  ]

  if (isDir) {
    return [
      {
        label: 'New File',
        icon: 'file-plus',
        onSelect: () => state.setTreeEdit({ type: 'create-file', dirPath: node.path })
      },
      {
        label: 'New Folder',
        icon: 'folder-plus',
        onSelect: () => state.setTreeEdit({ type: 'create-dir', dirPath: node.path })
      },
      { separator: true },
      ...shared
    ]
  }
  return [
    { label: 'Open', icon: 'file-text', onSelect: () => void state.openPaths([node.path]) },
    { separator: true },
    ...shared
  ]
}
