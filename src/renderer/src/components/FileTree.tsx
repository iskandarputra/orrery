import { memo, useMemo } from 'react'
import type { FileNode } from '@shared/types'
import { isMarkdownFile } from '@core/paths'
import { useStore } from '@/state/store'
import { openContextMenu } from './context-menu/context-menu'
import { Icon, type IconName } from './Icon'
import { buildTreeMenu } from './menus'
import { TreeEditInput } from './TreeEditInput'

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

function getFileIcon(fileName: string): IconName {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  if (isMarkdownFile(fileName)) return 'file-text'
  if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return 'image'
  if (['ts', 'js', 'json', 'py', 'rs', 'go', 'html', 'css', 'yml', 'yaml'].includes(ext))
    return 'code'
  return 'file'
}

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

  // When searching, auto-expand folders that contain matches
  const expanded = filter ? true : isExpanded

  const onMenu = (e: React.MouseEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    openContextMenu(e, buildTreeMenu(node))
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
          className={`tree-row tree-row--dir${creatingHere ? ' tree-row--creating' : ''}`}
          style={{ paddingLeft: DIR_PAD_PX }}
          onClick={() => toggleDir(node.path)}
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
          <Icon name={expanded ? 'folder-open' : 'folder'} size={15} className="tree-icon tree-icon--folder" />
          <span className="tree-label">{node.name}</span>
          <div className="tree-row__actions" onClick={(e) => e.stopPropagation()}>
            <button
              className="tree-row__action-btn"
              title="New note in folder"
              onClick={() => setTreeEdit({ type: 'create-file', dirPath: node.path })}
            >
              <Icon name="file-plus" size={13} />
            </button>
            <button
              className="tree-row__action-btn"
              title="More actions"
              onClick={onMenu}
            >
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
  const icon = getFileIcon(node.name)

  return (
    <div
      className={`tree-row tree-row--file${isActive ? ' tree-row--active' : ''}${
        isMd ? '' : ' tree-row--other'
      }`}
      style={{ paddingLeft: FILE_PAD_PX }}
      title={node.path}
      onClick={() => void openPaths([node.path])}
      onContextMenu={onMenu}
    >
      <Icon name={icon} size={14} className={`tree-icon${isActive ? ' tree-icon--active' : ''}`} />
      <span className="tree-label">{node.name}</span>
      <div className="tree-row__actions" onClick={(e) => e.stopPropagation()}>
        <button
          className="tree-row__action-btn"
          title="More actions"
          onClick={onMenu}
        >
          <Icon name="more-horizontal" size={13} />
        </button>
      </div>
    </div>
  )
})

export function FileTree(): React.JSX.Element | null {
  const tree = useStore((s) => s.tree)
  const treeEdit = useStore((s) => s.treeEdit)
  const filter = useStore((s) => s.fileTreeFilter)

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
    <div className="file-tree" role="tree">
      {creatingAtRoot && <TreeEditInput edit={treeEdit} indentPx={8} />}
      {filteredTree.children?.map((child) => (
        <TreeNode key={child.path} node={child} />
      ))}
    </div>
  )
}
