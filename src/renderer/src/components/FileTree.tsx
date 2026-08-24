import { memo } from 'react'
import type { FileNode } from '@shared/types'
import { isMarkdownFile } from '@core/paths'
import { useStore } from '@/state/store'
import { openContextMenu } from './context-menu/context-menu'
import { Icon } from './Icon'
import { buildTreeMenu } from './menus'
import { TreeEditInput } from './TreeEditInput'

const INDENT_PX = 12

const TreeNode = memo(function TreeNode({
  node,
  depth
}: {
  node: FileNode
  depth: number
}): React.JSX.Element {
  const expanded = useStore((s) => !!s.expandedDirs[node.path])
  const toggleDir = useStore((s) => s.toggleDir)
  const openPaths = useStore((s) => s.openPaths)
  const treeEdit = useStore((s) => s.treeEdit)
  const isActive = useStore((s) => {
    const active = s.activeId ? s.buffers[s.activeId] : null
    return active?.filePath === node.path
  })

  const onMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    openContextMenu(e, buildTreeMenu(node))
  }

  // Renaming this node replaces its row with an input.
  if (treeEdit?.type === 'rename' && treeEdit.path === node.path) {
    return <TreeEditInput edit={treeEdit} indentPx={depth * INDENT_PX} />
  }

  if (node.kind === 'directory') {
    const creatingHere = treeEdit && treeEdit.type !== 'rename' && treeEdit.dirPath === node.path
    return (
      <div>
        <button
          className="tree-row tree-row--dir"
          style={{ paddingLeft: depth * INDENT_PX + 6 }}
          onClick={() => toggleDir(node.path)}
          onContextMenu={onMenu}
          aria-expanded={expanded}
          title={node.name}
        >
          <Icon
            name="chevron-right"
            size={13}
            className={`tree-chevron${expanded ? ' tree-chevron--open' : ''}`}
          />
          <Icon name={expanded ? 'folder-open' : 'folder'} size={15} className="tree-icon" />
          <span className="tree-label">{node.name}</span>
        </button>
        {expanded && (
          <div className="tree-children">
            {creatingHere && <TreeEditInput edit={treeEdit} indentPx={(depth + 1) * INDENT_PX} />}
            {node.children?.map((child) => (
              <TreeNode key={child.path} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    )
  }

  const isMd = isMarkdownFile(node.path)
  return (
    <button
      className={`tree-row tree-row--file${isActive ? ' tree-row--active' : ''}${
        isMd ? '' : ' tree-row--other'
      }`}
      style={{ paddingLeft: depth * INDENT_PX + 6 + 15 }}
      title={node.path}
      onClick={() => void openPaths([node.path])}
      onContextMenu={onMenu}
    >
      <Icon name={isMd ? 'file-text' : 'file'} size={15} className="tree-icon" />
      <span className="tree-label">{node.name}</span>
    </button>
  )
})

export function FileTree(): React.JSX.Element | null {
  const tree = useStore((s) => s.tree)
  const treeEdit = useStore((s) => s.treeEdit)
  if (!tree) return null
  const creatingAtRoot = treeEdit && treeEdit.type !== 'rename' && treeEdit.dirPath === tree.path
  return (
    <div className="file-tree">
      {creatingAtRoot && <TreeEditInput edit={treeEdit} indentPx={0} />}
      {tree.children?.map((child) => (
        <TreeNode key={child.path} node={child} depth={0} />
      ))}
    </div>
  )
}
