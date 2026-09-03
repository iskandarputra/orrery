import { useState } from 'react'
import { buildPathTree, type PathTreeNode } from '@core/path-tree'
import { Icon } from './Icon'

/**
 * A list of changed files, flat or folded into folders.
 *
 * Shared by the working-tree lists and by a commit's files in the graph, which
 * ask the same question of the same shape of data and differ only in what a row
 * does when it is clicked — so the row itself stays with the caller, and this
 * owns the grouping, the indentation and the folding.
 */

/** One level of indent. Small: the panel is narrow and the names are long. */
export const CHANGE_INDENT_PX = 12

export type ChangeViewMode = 'list' | 'tree'

function DirRow({
  name,
  open,
  onToggle
}: {
  name: string
  open: boolean
  onToggle: () => void
}): React.JSX.Element {
  return (
    <button className="change-tree__dir" aria-expanded={open} onClick={onToggle} title={name}>
      <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />
      <span className="change-tree__dir-name">{name}</span>
    </button>
  )
}

function Nodes<T>({
  nodes,
  collapsed,
  onToggle,
  renderRow
}: {
  nodes: PathTreeNode<T>[]
  collapsed: Record<string, true>
  onToggle: (path: string) => void
  renderRow: (item: T) => React.JSX.Element
}): React.JSX.Element {
  return (
    <>
      {nodes.map((node) =>
        node.kind === 'file' ? (
          <div key={node.path}>{renderRow(node.item)}</div>
        ) : (
          <div key={node.path}>
            <DirRow
              name={node.name}
              open={!collapsed[node.path]}
              onToggle={() => onToggle(node.path)}
            />
            {!collapsed[node.path] && (
              <div className="change-tree__children" style={{ marginLeft: CHANGE_INDENT_PX }}>
                <Nodes
                  nodes={node.children}
                  collapsed={collapsed}
                  onToggle={onToggle}
                  renderRow={renderRow}
                />
              </div>
            )}
          </div>
        )
      )}
    </>
  )
}

export function ChangeTree<T>({
  items,
  getPath,
  mode,
  renderRow
}: {
  items: T[]
  getPath: (item: T) => string
  mode: ChangeViewMode
  renderRow: (item: T) => React.JSX.Element
}): React.JSX.Element {
  /**
   * Which folders are shut, rather than which are open.
   *
   * Everything starts expanded — a panel that opens with its contents hidden
   * has told the reader nothing — and this way that costs no state at all.
   */
  const [collapsed, setCollapsed] = useState<Record<string, true>>({})

  const toggle = (path: string): void =>
    setCollapsed((current) => {
      const next = { ...current }
      if (next[path]) delete next[path]
      else next[path] = true
      return next
    })

  if (mode === 'list') {
    // The caller's order, untouched: git decided it, and flat is what "list"
    // means. Sorting is a thing the tree does on its way to grouping.
    return (
      <div className="change-tree">
        {items.map((item) => (
          <div key={getPath(item)}>{renderRow(item)}</div>
        ))}
      </div>
    )
  }

  return (
    <div className="change-tree">
      <Nodes
        nodes={buildPathTree(items, getPath)}
        collapsed={collapsed}
        onToggle={toggle}
        renderRow={renderRow}
      />
    </div>
  )
}
