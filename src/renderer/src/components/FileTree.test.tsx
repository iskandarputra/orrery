import { render, cleanup } from '@testing-library/react'
import type { FileNode } from '@shared/types'
import { afterEach, describe, expect, it } from 'vitest'
import { useStore } from '@/state/store'
import { FileTree, INDENT_PX } from './FileTree'

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

    // Against the constant, not a copy of its value: what matters here is that
    // every level steps by the same amount. That the step also lands the level's
    // guide on its folder's chevron is geometry, and is checked in the e2e
    // file-tree spec where there is a real layout to measure.
    const [a, b] = dirs.map(leftOffset)
    expect(b! - a!).toBe(INDENT_PX)
  })
})
