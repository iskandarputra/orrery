import { cleanup, fireEvent, render } from '@testing-library/react'
import { defaultSettings } from '@shared/settings'
import type { OrreryApi } from '@shared/ipc'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { setClient } from '@/services/client'
import { useStore } from '@/state/store'
import { SidebarRail } from './SidebarRail'

/**
 * The rail drives two views now, so the interesting behaviour is no longer
 * "does the sidebar toggle" but "which view does a click leave showing".
 */

/** Enough of main to absorb the settings write `updateSettings` fires off. */
const fakeMain = {
  invoke: (channel: string) =>
    Promise.resolve(channel === 'settings:get' ? useStore.getState().settings : undefined),
  on: () => () => {}
} as unknown as OrreryApi

const sidebar = (): { visible: boolean; view: string } => {
  const { visible, view } = useStore.getState().settings.sidebar
  return { visible, view }
}

const click = (container: HTMLElement, label: RegExp): void => {
  const btn = Array.from(container.querySelectorAll('button')).find((b) =>
    label.test(b.getAttribute('aria-label') ?? '')
  )
  if (!btn) throw new Error(`no rail button matching ${label}`)
  fireEvent.click(btn)
}

beforeEach(() => {
  setClient(fakeMain)
  useStore.setState({ settings: { ...defaultSettings } })
})
afterEach(cleanup)

describe('SidebarRail views', () => {
  it('opens source control on the left', () => {
    const { container } = render(<SidebarRail />)
    click(container, /source control/i)
    expect(sidebar()).toEqual({ visible: true, view: 'git' })
  })

  it('hides the sidebar when the view already showing is clicked again', () => {
    const { container } = render(<SidebarRail />)
    click(container, /source control/i)
    click(container, /source control/i)
    expect(sidebar()).toEqual({ visible: false, view: 'git' })
  })

  it('reopens on the view it was left on', () => {
    // Hiding is "get out of my way", not "forget where I was".
    const { container } = render(<SidebarRail />)
    click(container, /source control/i)
    click(container, /source control/i)
    click(container, /source control/i)
    expect(sidebar()).toEqual({ visible: true, view: 'git' })
  })

  it('switches views rather than hiding when the other icon is clicked', () => {
    // The bug this guards: the files icon used to toggle visibility outright,
    // so asking for the file tree while on source control hid the sidebar.
    const { container } = render(<SidebarRail />)
    click(container, /source control/i)
    click(container, /files/i)
    expect(sidebar()).toEqual({ visible: true, view: 'files' })
  })

  it('marks the showing view as pressed', () => {
    const { container } = render(<SidebarRail />)
    click(container, /source control/i)
    const pressed = Array.from(container.querySelectorAll('button'))
      .filter((b) => b.getAttribute('aria-pressed') === 'true')
      .map((b) => b.getAttribute('aria-label'))
    expect(pressed).toHaveLength(1)
    expect(pressed[0]).toMatch(/source control/i)
  })
})
