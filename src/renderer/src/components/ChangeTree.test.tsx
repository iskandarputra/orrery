import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ChangeTree, CHANGE_INDENT_PX } from './ChangeTree'

interface Change {
  path: string
}

const changes: Change[] = [
  { path: 'src/renderer/components/GitGraph.tsx' },
  { path: 'src/renderer/components/Icon.tsx' },
  { path: 'README.md' }
]

const renderRow = (change: Change): React.JSX.Element => (
  <span className="row" data-path={change.path}>
    {change.path}
  </span>
)

const paths = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll<HTMLElement>('.row')).map((r) => r.dataset.path!)

const dirNames = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll<HTMLElement>('.change-tree__dir')).map(
    (d) => d.textContent ?? ''
  )

afterEach(cleanup)

describe('ChangeTree', () => {
  it('renders one row per change and no folders in list mode', () => {
    const { container } = render(
      <ChangeTree items={changes} getPath={(c) => c.path} mode="list" renderRow={renderRow} />
    )
    expect(paths(container)).toEqual([
      'src/renderer/components/GitGraph.tsx',
      'src/renderer/components/Icon.tsx',
      'README.md'
    ])
    expect(dirNames(container)).toEqual([])
  })

  it('keeps the caller-given order in list mode', () => {
    // git decides what order changes arrive in; list mode is the flat truth of
    // that list, so sorting belongs to tree mode alone.
    const { container } = render(
      <ChangeTree
        items={[{ path: 'z.md' }, { path: 'a.md' }]}
        getPath={(c) => c.path}
        mode="list"
        renderRow={renderRow}
      />
    )
    expect(paths(container)).toEqual(['z.md', 'a.md'])
  })

  it('groups changes under a compacted folder row in tree mode', () => {
    const { container } = render(
      <ChangeTree items={changes} getPath={(c) => c.path} mode="tree" renderRow={renderRow} />
    )
    expect(dirNames(container)).toEqual(['src/renderer/components'])
    expect(paths(container)).toEqual([
      'src/renderer/components/GitGraph.tsx',
      'src/renderer/components/Icon.tsx',
      'README.md'
    ])
  })

  it('indents a folder’s contents by one step', () => {
    const { container } = render(
      <ChangeTree items={changes} getPath={(c) => c.path} mode="tree" renderRow={renderRow} />
    )
    const nested = container.querySelector<HTMLElement>('.change-tree__children')!
    expect(parseFloat(nested.style.marginLeft)).toBe(CHANGE_INDENT_PX)
  })

  it('starts expanded and collapses a folder when it is clicked', () => {
    // Expanded first: a panel that opens with everything hidden makes the
    // reader click before it has told them anything.
    const { container } = render(
      <ChangeTree items={changes} getPath={(c) => c.path} mode="tree" renderRow={renderRow} />
    )
    expect(paths(container)).toHaveLength(3)

    fireEvent.click(container.querySelector('.change-tree__dir')!)
    expect(paths(container)).toEqual(['README.md'])

    fireEvent.click(container.querySelector('.change-tree__dir')!)
    expect(paths(container)).toHaveLength(3)
  })

  it('tells assistive tech whether a folder is open', () => {
    const { container } = render(
      <ChangeTree items={changes} getPath={(c) => c.path} mode="tree" renderRow={renderRow} />
    )
    const dir = container.querySelector('.change-tree__dir')!
    expect(dir.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(dir)
    expect(dir.getAttribute('aria-expanded')).toBe('false')
  })
})
