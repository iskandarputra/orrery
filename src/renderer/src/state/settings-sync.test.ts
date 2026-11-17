import { describe, expect, it } from 'vitest'
import { defaultSettings } from '@shared/settings'
import { useStore } from './store'

/**
 * Settings main changed on its own, arriving in the window.
 *
 * They arrive separately from the reply to the window's own changes, and in
 * either order. Taken whole, a push sent before the window hid its sidebar
 * could land after and show it again, and the next sidebar edit would send
 * that back to main. So a push is merged: only the keys main changed move.
 */
describe('adoptSettings', () => {
  it('takes the keys main changed', () => {
    useStore.setState({ settings: defaultSettings })
    useStore.getState().adoptSettings({ recentFiles: ['/vault/a.md'], zoomLevel: 2 })
    expect(useStore.getState().settings.recentFiles).toEqual(['/vault/a.md'])
    expect(useStore.getState().settings.zoomLevel).toBe(2)
  })

  it('leaves every other key as the window has it, same object and all', () => {
    const sidebar = { ...defaultSettings.sidebar, visible: false }
    useStore.setState({ settings: { ...defaultSettings, sidebar } })

    useStore.getState().adoptSettings({ recentFiles: ['/vault/b.md'] })

    expect(useStore.getState().settings.sidebar).toBe(sidebar)
    expect(useStore.getState().settings.sidebar.visible).toBe(false)
  })
})
