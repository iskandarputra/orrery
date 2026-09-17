import type { FileNode } from '@shared/types'
import { MAX_PANES } from '@core/tab-layout'
import { dirname } from '@core/paths'
import { relativeToRoot } from '@core/tree-actions'
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

  const pinned = buffer.filePath ? state.settings.bookmarks.includes(buffer.filePath) : false

  return [
    {
      label: pinned ? 'Remove bookmark' : 'Bookmark',
      icon: 'bookmark',
      disabled: !buffer.filePath,
      onSelect: () => buffer.filePath && state.toggleBookmark(buffer.filePath)
    },
    {
      label: 'Split Right',
      icon: 'columns',
      // Off when it is already in a pane: the same buffer in two editors would
      // be one file with two histories.
      disabled: state.paneIds.length >= MAX_PANES || state.paneIds.includes(bufferId),
      onSelect: () => state.splitRight(bufferId)
    },
    { separator: true },
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

/**
 * The actions that move a file about or take you somewhere with it, shared by
 * every node and by the empty space under the tree.
 */
function placeItems(dir: string): MenuItem[] {
  const state = appState()
  return [
    {
      label: 'Reveal in File Manager',
      icon: 'folder-open',
      onSelect: () => void invoke('shell:showItemInFolder', { path: dir })
    },
    {
      label: 'Open in Integrated Terminal',
      icon: 'terminal',
      onSelect: () => state.openTerminalAt(dir)
    }
  ]
}

function copyPathItems(path: string): MenuItem[] {
  const root = appState().rootPath
  return [
    { label: 'Copy Path', icon: 'copy', onSelect: () => void navigator.clipboard.writeText(path) },
    {
      label: 'Copy Relative Path',
      disabled: !root,
      onSelect: () => void navigator.clipboard.writeText(root ? relativeToRoot(root, path) : path)
    }
  ]
}

function pasteItem(intoDir: string): MenuItem {
  const state = appState()
  const clip = state.treeClipboard
  return {
    label: clip ? `Paste${clip.paths.length > 1 ? ` ${clip.paths.length} items` : ''}` : 'Paste',
    disabled: !clip,
    onSelect: () => void state.pasteInto(intoDir)
  }
}

/** Context menu for a file-tree node. */
export function buildTreeMenu(node: FileNode): MenuItem[] {
  const state = appState()
  const isDir = node.kind === 'directory'
  // A file's folder is where its terminal opens and where a paste on it lands,
  // as they do in VS Code: there is nowhere inside a file to put anything.
  const dir = isDir ? node.path : dirname(node.path)

  const clipboard: MenuItem[] = [
    { label: 'Cut', onSelect: () => state.setTreeClipboard('cut', [node.path]) },
    { label: 'Copy', onSelect: () => state.setTreeClipboard('copy', [node.path]) },
    pasteItem(dir)
  ]

  const edit: MenuItem[] = [
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
      ...placeItems(dir),
      { label: 'Find in Folder…', icon: 'search', onSelect: () => state.searchInFolder(node.path) },
      { separator: true },
      ...clipboard,
      { separator: true },
      ...copyPathItems(node.path),
      { separator: true },
      ...edit
    ]
  }
  return [
    { label: 'Open', icon: 'file-text', onSelect: () => void state.openPaths([node.path]) },
    {
      label: 'Open to the Side',
      icon: 'columns',
      disabled: state.paneIds.length >= MAX_PANES,
      onSelect: () => void state.openToSide(node.path)
    },
    { separator: true },
    ...placeItems(dir),
    { separator: true },
    {
      label: state.settings.bookmarks.includes(node.path) ? 'Remove bookmark' : 'Bookmark',
      icon: 'bookmark',
      onSelect: () => state.toggleBookmark(node.path)
    },
    { separator: true },
    ...clipboard,
    { separator: true },
    ...copyPathItems(node.path),
    { separator: true },
    ...edit
  ]
}

/**
 * Context menu for the empty space under the tree, which stands for the vault.
 *
 * Without it there was no way to paste into the top of the vault, since every
 * row is something inside it.
 */
export function buildTreeRootMenu(root: string): MenuItem[] {
  const state = appState()
  return [
    {
      label: 'New File',
      icon: 'file-plus',
      onSelect: () => state.setTreeEdit({ type: 'create-file', dirPath: root })
    },
    {
      label: 'New Folder',
      icon: 'folder-plus',
      onSelect: () => state.setTreeEdit({ type: 'create-dir', dirPath: root })
    },
    { separator: true },
    ...placeItems(root),
    { label: 'Find in Folder…', icon: 'search', onSelect: () => state.searchInFolder(root) },
    { separator: true },
    pasteItem(root),
    { separator: true },
    { label: 'Copy Path', icon: 'copy', onSelect: () => void navigator.clipboard.writeText(root) }
  ]
}
