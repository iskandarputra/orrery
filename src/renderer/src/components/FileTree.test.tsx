import { render, cleanup } from '@testing-library/react'
import type { FileNode } from '@shared/types'
import { afterEach, describe, expect, it } from 'vitest'
import { useStore } from '@/state/store'
import { FileTree } from './FileTree'

const tree: FileNode = {
  name: 'root',
  path: '/root',
  kind: 'directory',
  children: [
    {
      name: 'a',
      path: '/root/a',
      kind: 'directory',
      children: [
        {
          name: 'b',
          path: '/root/a/b',
          kind: 'directory',
          children: [{ name: 'deep.md', path: '/root/a/b/deep.md', kind: 'file' }]
        }
      ]
    }
  ]
}

/** Left offset of a row relative to the tree root: own padding + every ancestor indent. */
function leftOffset(row: HTMLElement): number {
  let offset = parseFloat(row.style.paddingLeft) || 0
  let el = row.parentElement
  while (el && !el.classList.contains('file-tree')) {
    offset += parseFloat(el.style.marginLeft) || 0
    el = el.parentElement
  }
  return offset
}

afterEach(cleanup)

describe('FileTree indentation', () => {
  it('indents each level by one constant step', () => {
    useStore.setState({
      tree,
      fileTreeFilter: '',
      treeEdit: null,
      expandedDirs: { '/root/a': true, '/root/a/b': true }
    })
    const { container } = render(<FileTree />)
    const dirs = Array.from(container.querySelectorAll<HTMLElement>('.tree-row--dir'))
    expect(dirs.map((d) => d.textContent?.slice(0, 1))).toEqual(['a', 'b'])

    const [a, b] = dirs.map(leftOffset)
    expect(b! - a!).toBe(14)
  })
})
