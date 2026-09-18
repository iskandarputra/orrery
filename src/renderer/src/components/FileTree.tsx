import { memo, useEffect, useMemo, useRef } from 'react'
import type { FileNode } from '@shared/types'
import { dirname, isMarkdownFile } from '@core/paths'
import { canDropInto, dropDir, TREE_DRAG_TYPE, type ClipboardMode } from '@core/tree-actions'
import {
  clickSelect,
  findRow,
  moveSelect,
  parentRow,
  stepFocus,
  topmostSelected,
  visiblePaths
} from '@core/tree-selection'
import { useStore } from '@/state/store'
import { openContextMenu, useContextMenu } from './context-menu/context-menu'
import { Icon } from './Icon'
import { buildTreeMenu, buildTreeRootMenu, trashWithConfirm } from './menus'
import { TreeEditInput, editNameOf } from './TreeEditInput'
import { FileTypeIcon, FolderTypeIcon } from './FileIcon'

/**
 * One indent step per level, applied by the nested `.tree-children` box.
 *
 * 15 rather than a round number so the level's guide line lands exactly on the
 * centre of the parent folder's chevron (8px row padding + half of the 14px
 * chevron box) — the line then reads as descending from the folder it belongs
 * to instead of floating beside it.
 */
export const INDENT_PX = 15
/** Row padding inside its level's box: directories lead with a chevron, files don't. */
const DIR_PAD_PX = 8
const FILE_PAD_PX = 22

/** Filter tree hierarchy: keep node if itself matches or any descendant matches */
function filterNode(node: FileNode, filter: string): FileNode | null {
  if (!filter) return node
  const matchesSelf = node.name.toLowerCase().includes(filter.toLowerCase())
  if (node.kind === 'file') {
    return matchesSelf ? node : null
  }
  if (!node.children) return matchesSelf ? node : null

  const filteredChildren: FileNode[] = []
  for (const child of node.children) {
    const res = filterNode(child, filter)
    if (res) filteredChildren.push(res)
  }

  if (matchesSelf || filteredChildren.length > 0) {
    return {
      ...node,
      children: filteredChildren
    }
  }
  return null
}

/**
 * The rows as they are drawn right now, top to bottom.
 *
 * Read from the store when a click or a key needs it rather than held as
 * state: it changes with every folder opened, and only the handlers use it.
 */
function drawnRows(): string[] {
  const { tree, expandedDirs, fileTreeFilter } = useStore.getState()
  if (!tree) return []
  const filter = fileTreeFilter.trim()
  const shown = filter ? filterNode(tree, filter) : tree
  // A filter opens every folder with a match in it, whatever was open before.
  return shown ? visiblePaths(shown, (p) => !!filter || !!expandedDirs[p]) : []
}

/** An element id for a row, for `aria-activedescendant`. */
const rowId = (path: string): string => `tree-row-${encodeURIComponent(path)}`

/** Ctrl or Cmd held during a drag copies instead of moving, as VS Code does. */
const dragMode = (e: React.DragEvent): ClipboardMode => (e.ctrlKey || e.metaKey ? 'copy' : 'cut')

/**
 * Take a drag over this folder, or refuse it.
 *
 * The browser drops nothing unless the dragover is prevented, so refusing is
 * simply not preventing it: the pointer keeps the "no" cursor and the folder
 * is not lit up.
 */
function dragOverDir(e: React.DragEvent, into: string): void {
  const state = useStore.getState()
  const drag = state.treeDrag
  if (!drag) return
  // The row decides, not the tree behind it, whose target is the vault root.
  e.stopPropagation()
  if (!canDropInto(drag.paths, into, dragMode(e))) {
    if (drag.into !== null) state.setTreeDrag({ ...drag, into: null })
    return
  }
  e.preventDefault()
  e.dataTransfer.dropEffect = dragMode(e) === 'copy' ? 'copy' : 'move'
  if (drag.into !== into) state.setTreeDrag({ ...drag, into })
}

/** Move or copy what is being dragged into this folder. */
function dropIntoDir(e: React.DragEvent, into: string): void {
  const state = useStore.getState()
  const drag = state.treeDrag
  state.setTreeDrag(null)
  if (!drag) return
  e.preventDefault()
  e.stopPropagation()
  const mode = dragMode(e)
  if (!canDropInto(drag.paths, into, mode)) return
  void state.transferInto(mode, drag.paths, into)
}

const TreeNode = memo(function TreeNode({ node }: { node: FileNode }): React.JSX.Element {
  const expandedDirs = useStore((s) => s.expandedDirs)
  const isExpanded = !!expandedDirs[node.path]
  const toggleDir = useStore((s) => s.toggleDir)
  const openPaths = useStore((s) => s.openPaths)
  const treeEdit = useStore((s) => s.treeEdit)
  const setTreeEdit = useStore((s) => s.setTreeEdit)
  const filter = useStore((s) => s.fileTreeFilter)
  const isActive = useStore((s) => {
    const active = s.activeId ? s.buffers[s.activeId] : null
    return active?.filePath === node.path
  })
  const selected = useStore((s) => s.treeSelection.paths.includes(node.path))
  const focused = useStore((s) => s.treeSelection.focus === node.path)
  // Only a folder lights up: a drop on a file means the folder it is in, and
  // lighting every file in that folder would say the wrong thing.
  const dropping = useStore((s) => node.kind === 'directory' && s.treeDrag?.into === node.path)
  const rowRef = useRef<HTMLDivElement>(null)

  // Keep the keyboard's row in sight as the arrows move it.
  useEffect(() => {
    if (focused) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [focused])

  /**
   * Update the selection for a click. True when the click was only about the
   * selection, Ctrl or Shift held, and should not also open the row.
   */
  const select = (e: React.MouseEvent): boolean => {
    const mods = { toggle: e.ctrlKey || e.metaKey, range: e.shiftKey }
    const state = useStore.getState()
    state.setTreeSelection(clickSelect(state.treeSelection, node.path, mods, drawnRows()))
    return mods.toggle || mods.range
  }

  // When searching, auto-expand folders that contain matches
  const expanded = filter ? true : isExpanded

  const onMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    // Right-clicking a row outside the selection makes it the selection, as
    // VS Code does; inside it, the menu acts on everything selected.
    const state = useStore.getState()
    if (!state.treeSelection.paths.includes(node.path)) {
      state.setTreeSelection({ paths: [node.path], anchor: node.path, focus: node.path })
    }
    openContextMenu(e, buildTreeMenu(node))
  }

  const rowState =
    `${selected ? ' tree-row--selected' : ''}${focused ? ' tree-row--focused' : ''}` +
    `${dropping ? ' tree-row--drop' : ''}`

  /**
   * Start a drag of this row. Dragging a row inside the selection takes the
   * whole selection, as VS Code does; dragging one outside it makes it the
   * selection first, so what will move is what is lit up.
   */
  const onDragStart = (e: React.DragEvent): void => {
    const state = useStore.getState()
    const chosen = state.treeSelection.paths
    const paths = chosen.includes(node.path) ? topmostSelected(chosen, drawnRows()) : [node.path]
    if (!chosen.includes(node.path)) {
      state.setTreeSelection({ paths: [node.path], anchor: node.path, focus: node.path })
    }
    state.setTreeDrag({ paths, into: null })
    e.dataTransfer.effectAllowed = 'copyMove'
    // The editor opens these rather than writing their paths into the note.
    e.dataTransfer.setData(TREE_DRAG_TYPE, paths.join('\n'))
    // Dropped outside the app, a path is the useful thing to hand over.
    e.dataTransfer.setData('text/plain', paths.join('\n'))
  }

  const dragProps = {
    draggable: true,
    onDragStart,
    onDragEnd: () => useStore.getState().setTreeDrag(null),
    onDragOver: (e: React.DragEvent) => dragOverDir(e, dropDir(node)),
    onDrop: (e: React.DragEvent) => dropIntoDir(e, dropDir(node))
  }

  // Renaming this node replaces its row with an input.
  if (treeEdit?.type === 'rename' && treeEdit.path === node.path) {
    return (
      <TreeEditInput
        edit={treeEdit}
        indentPx={node.kind === 'directory' ? DIR_PAD_PX : FILE_PAD_PX}
      />
    )
  }

  if (node.kind === 'directory') {
    const creatingHere = treeEdit && treeEdit.type !== 'rename' && treeEdit.dirPath === node.path
    return (
      <div className="tree-dir-group">
        <div
          ref={rowRef}
          id={rowId(node.path)}
          role="treeitem"
          aria-selected={selected}
          className={`tree-row tree-row--dir${creatingHere ? ' tree-row--creating' : ''}${rowState}`}
          style={{ paddingLeft: DIR_PAD_PX }}
          {...dragProps}
          onClick={(e) => {
            if (!select(e)) toggleDir(node.path)
          }}
          onContextMenu={onMenu}
          aria-expanded={expanded}
          title={node.name}
        >
          <span className="tree-chevron-wrap">
            <Icon
              name="chevron-right"
              size={12}
              className={`tree-chevron${expanded ? ' tree-chevron--open' : ''}`}
            />
          </span>
          <FolderTypeIcon
            folderName={node.name}
            size={15}
            className="tree-icon tree-icon--folder"
          />
          <span className="tree-label">{node.name}</span>
          <div className="tree-row__actions" onClick={(e) => e.stopPropagation()}>
            <button
              className="tree-row__action-btn"
              title="New note in folder"
              onClick={() => setTreeEdit({ type: 'create-file', dirPath: node.path })}
            >
              <Icon name="file-plus" size={13} />
            </button>
            <button className="tree-row__action-btn" title="More actions" onClick={onMenu}>
              <Icon name="more-horizontal" size={13} />
            </button>
          </div>
        </div>
        {expanded && (
          <div className="tree-children" style={{ marginLeft: INDENT_PX }}>
            {creatingHere && <TreeEditInput edit={treeEdit} indentPx={4} />}
            {node.children?.map((child) => (
              <TreeNode key={child.path} node={child} />
            ))}
          </div>
        )}
      </div>
    )
  }

  const isMd = isMarkdownFile(node.path)

  return (
    <div
      ref={rowRef}
      id={rowId(node.path)}
      role="treeitem"
      aria-selected={selected}
      className={`tree-row tree-row--file${isActive ? ' tree-row--active' : ''}${
        isMd ? '' : ' tree-row--other'
      }${rowState}`}
      style={{ paddingLeft: FILE_PAD_PX }}
      title={node.path}
      {...dragProps}
      onClick={(e) => {
        if (!select(e)) void openPaths([node.path])
      }}
      onContextMenu={onMenu}
    >
      <FileTypeIcon
        fileName={node.name}
        size={14}
        className={`tree-icon${isActive ? ' tree-icon--active' : ''}`}
      />
      <span className="tree-label">{node.name}</span>
      <div className="tree-row__actions" onClick={(e) => e.stopPropagation()}>
        <button className="tree-row__action-btn" title="More actions" onClick={onMenu}>
          <Icon name="more-horizontal" size={13} />
        </button>
      </div>
    </div>
  )
})

/**
 * The tree's keys, as VS Code's explorer has them.
 *
 * Only while the tree itself has focus: a rename or a new name is typed into an
 * input inside it, and those keys are that input's.
 */
function onTreeKey(e: React.KeyboardEvent<HTMLDivElement>): void {
  if (e.target !== e.currentTarget) return
  // A menu opened from a row leaves the tree focused, and its keys are the
  // menu's: Escape here used to clear the selection and stop there, so the
  // menu's own listener on the window never heard it and the menu stayed open.
  if (useContextMenu.getState().open) return
  // The same for anything drawn over the window. The media viewer opens from a
  // button that keeps focus where it was, so the tree can still hold it, and
  // Escape and the arrows are the viewer's; every overlay listens on the window
  // and every one of them sits in a `.modal-backdrop`.
  if (document.querySelector('.modal-backdrop')) return
  const state = useStore.getState()
  if (!state.tree) return
  const order = drawnRows()
  const current = state.treeSelection
  const focus = current.focus && order.includes(current.focus) ? current.focus : null
  const row = focus ? findRow(state.tree, focus) : null
  const mod = e.ctrlKey || e.metaKey
  const filtering = !!state.fileTreeFilter.trim()
  const isOpen = (path: string): boolean => filtering || !!state.expandedDirs[path]
  const select = (target: string | null, extend = false): void => {
    if (target) state.setTreeSelection(moveSelect(current, target, extend, order))
  }

  let handled = true
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    select(stepFocus(order, focus, e.key === 'ArrowDown' ? 1 : -1), e.shiftKey)
  } else if (e.key === 'ArrowRight' && row?.kind === 'directory') {
    // Closed: open it. Open: step onto the first thing in it, which is the next
    // row drawn. A filter shows folders open whatever they are set to, and
    // toggling one then would change nothing on screen.
    if (!isOpen(row.path)) state.toggleDir(row.path)
    else if (row.children?.length) select(stepFocus(order, row.path, 1))
  } else if (e.key === 'ArrowLeft' && row) {
    // An open folder closes; anything else goes to the folder it is in.
    if (row.kind === 'directory' && state.expandedDirs[row.path] && !filtering) {
      state.toggleDir(row.path)
    } else {
      select(parentRow(order, row.path))
    }
  } else if (e.key === 'Enter' && row) {
    if (row.kind === 'directory') state.toggleDir(row.path)
    else void state.openPaths([row.path])
  } else if (e.key === 'F2' && row && current.paths.length <= 1) {
    state.setTreeEdit({ type: 'rename', path: row.path, ...editNameOf(row.path) })
  } else if (e.key === 'Delete' && current.paths.length > 0) {
    trashWithConfirm(topmostSelected(current.paths, order))
  } else if (e.key === 'Escape' && current.paths.length > 0) {
    state.setTreeSelection({ paths: [], anchor: null, focus })
  } else if (mod && (e.key === 'c' || e.key === 'x') && current.paths.length > 0) {
    state.setTreeClipboard(e.key === 'x' ? 'cut' : 'copy', topmostSelected(current.paths, order))
  } else if (mod && e.key === 'v' && state.treeClipboard) {
    // Into the folder the keyboard is on, or the one its file is in, or the
    // top of the vault when nothing is.
    const into = !row ? state.tree.path : row.kind === 'directory' ? row.path : dirname(row.path)
    void state.pasteInto(into)
  } else if (mod && e.key === 'a') {
    state.setTreeSelection({
      paths: order,
      anchor: order[0] ?? null,
      focus: focus ?? order[0] ?? null
    })
  } else {
    handled = false
  }
  if (handled) {
    e.preventDefault()
    // Not on to the window, where a board listening for Delete would take the
    // same key for its own selected cards.
    e.stopPropagation()
  }
}

export function FileTree(): React.JSX.Element | null {
  const tree = useStore((s) => s.tree)
  const treeEdit = useStore((s) => s.treeEdit)
  const filter = useStore((s) => s.fileTreeFilter)
  const focus = useStore((s) => s.treeSelection.focus)
  // A drop on the space around the rows means the top of the vault.
  const droppingAtRoot = useStore((s) => !!s.tree && s.treeDrag?.into === s.tree.path)

  const filteredTree = useMemo(() => {
    if (!tree || !filter.trim()) return tree
    return filterNode(tree, filter.trim())
  }, [tree, filter])

  if (!filteredTree) {
    if (filter) {
      return (
        <div className="tree-empty-search">
          <Icon name="search" size={20} className="tree-empty-search__icon" />
          <p>No notes matching “{filter}”</p>
        </div>
      )
    }
    return null
  }

  const creatingAtRoot = treeEdit && treeEdit.type !== 'rename' && treeEdit.dirPath === tree?.path

  return (
    <div
      className={`file-tree${droppingAtRoot ? ' file-tree--drop' : ''}`}
      role="tree"
      aria-label="Files"
      aria-multiselectable="true"
      aria-activedescendant={focus ? rowId(focus) : undefined}
      // Focusable itself, so a click on any row gives the tree the keyboard.
      tabIndex={0}
      onKeyDown={onTreeKey}
      // Rows stop their own drag events, so these are the space around them.
      onDragOver={(e) => tree && dragOverDir(e, tree.path)}
      onDrop={(e) => tree && dropIntoDir(e, tree.path)}
      onDragLeave={(e) => {
        // Only when the pointer has left the tree itself, not on the way from
        // one row to the next.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        const drag = useStore.getState().treeDrag
        if (drag?.into) useStore.getState().setTreeDrag({ ...drag, into: null })
      }}
      // Rows stop their own right-clicks, so this is only the space around them.
      onContextMenu={(e) => {
        if (!tree) return
        e.preventDefault()
        openContextMenu(e, buildTreeRootMenu(tree.path))
      }}
    >
      {creatingAtRoot && <TreeEditInput edit={treeEdit} indentPx={8} />}
      {filteredTree.children?.map((child) => (
        <TreeNode key={child.path} node={child} />
      ))}
    </div>
  )
}
