import { injectThemeCss } from '@/themes/themes'
import { useEffect, useRef } from 'react'
import { PAGE_ZOOM_COMMANDS, zoomForWheel } from '@core/zoom-keys'
import { getRegistry } from '@/bootstrap'
import { invoke } from '@/services/client'
import { useStore } from '@/state/store'
import { ContextMenu } from '@/components/context-menu/ContextMenu'
import { DocStatsModal } from '@/components/DocStatsModal'
import { MediaViewerModal } from '@/components/MediaViewerModal'
import { TerminalPanel } from '@/components/TerminalPanel'
import { EditorPane } from '@/components/EditorPane'
import { AnalyticsView } from './components/AnalyticsView'
import { HistoryModal } from './components/HistoryModal'
import { GraphView } from '@/components/GraphView'
import { HeaderBar } from '@/components/HeaderBar'
import { Palette } from '@/components/Palette'
import { RightPanel } from '@/components/RightPanel'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { McpApprovalModal } from '@/components/McpApprovalModal'
import { McpElicitModal, McpPromptModal, McpSamplingModal } from '@/components/McpElicitModal'
import { Sidebar } from '@/components/Sidebar'
import { SidebarRail } from '@/components/SidebarRail'
import { StatusBar } from '@/components/StatusBar'
import { TabBar } from '@/components/TabBar'
import { Toast } from '@/components/Toast'
import { Toolbar } from '@/components/Toolbar'
import { WelcomeView } from '@/components/WelcomeView'

/**
 * Keep the window's own background in step with the theme.
 *
 * Main paints the frame with this before anything has rendered in it, so the
 * window that appears already looks like the app rather than a dark rectangle
 * that turns white. Written only when it actually changes: this runs on every
 * theme application.
 */
function rememberBackground(): void {
  const colour = getComputedStyle(document.documentElement).getPropertyValue('--or-bg').trim()
  if (!colour) return
  const state = useStore.getState()
  if (state.settings.window.background === colour) return
  state.updateSettings({ window: { ...state.settings.window, background: colour } })
}

function useThemeSync(): void {
  const mode = useStore((s) => s.settings.theme)
  const lightTheme = useStore((s) => s.settings.lightTheme)
  const darkTheme = useStore((s) => s.settings.darkTheme)
  const highContrastCode = useStore((s) => s.settings.highContrastCode)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const appearance = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode
      // Whichever comes first, the frame or the settings: the palettes must be
      // in the document before one of them is named.
      injectThemeCss()
      document.documentElement.dataset['theme'] = appearance === 'dark' ? darkTheme : lightTheme
      rememberBackground()
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [mode, lightTheme, darkTheme])

  // Its own attribute rather than a second set of themes: every palette ships
  // both variants in the stylesheet, and this picks between them.
  useEffect(() => {
    if (highContrastCode) document.documentElement.dataset['hcCode'] = 'on'
    else delete document.documentElement.dataset['hcCode']
  }, [highContrastCode])
}

/**
 * Ctrl and the wheel, the two zooms the keys already offer.
 *
 * It has to be done here rather than in main. `before-input-event` is keyboard
 * only, and Chromium's own ctrl-wheel zoom belongs to browser chrome that an
 * Electron window does not have, so without this the gesture every other app on
 * the machine has simply does nothing.
 *
 * Capture phase, and it asks the target rather than reading `defaultPrevented`.
 * React registers `wheel` on its root as a passive listener, so `preventDefault`
 * inside an `onWheel` handler is a no-op and the flag those surfaces think they
 * are setting never gets set. `data-owns-zoom` is the surfaces saying so
 * themselves, which is a claim that survives whatever React does with the event.
 */
function useZoomWheel(): void {
  const carried = useRef(0)
  useEffect(() => {
    const onWheel = (e: WheelEvent): void => {
      const target = e.target as HTMLElement | null
      if (target?.closest?.('[data-owns-zoom]')) return

      const zoom = zoomForWheel(
        { deltaY: e.deltaY, control: e.ctrlKey, meta: e.metaKey, shift: e.shiftKey, alt: e.altKey },
        carried.current
      )
      if (!zoom.zooming) {
        carried.current = 0
        return
      }
      // Taken from the page as soon as the gesture is recognised, not when a
      // step lands: a pinch spends several events below the threshold, and
      // letting those through scrolls the document out from under the zoom.
      e.preventDefault()
      carried.current = zoom.rest
      if (!zoom.action) return

      if (zoom.action === 'window-in') void invoke('window:setZoom', { by: 1 })
      else if (zoom.action === 'window-out') void invoke('window:setZoom', { by: -1 })
      else if (zoom.action !== 'window-reset') {
        getRegistry()?.execute(PAGE_ZOOM_COMMANDS[zoom.action])
      }
    }
    // Not passive: the whole point is to stop the scroll the wheel asked for.
    window.addEventListener('wheel', onWheel, { capture: true, passive: false })
    return () => window.removeEventListener('wheel', onWheel, { capture: true })
  }, [])
}

function useWindowTitleSync(): void {
  const active = useStore((s) => (s.activeId ? s.buffers[s.activeId] : null))
  useEffect(() => {
    const title = active ? `${active.isDirty ? '● ' : ''}${active.fileName} — Orrery` : 'Orrery'
    void invoke('window:setTitle', { title })
  }, [active])
}

export function App(): React.JSX.Element {
  const hasTabs = useStore((s) => s.tabOrder.length > 0)
  const zenMode = useStore((s) => s.zenMode)
  const toggleZenMode = useStore((s) => s.toggleZenMode)

  useThemeSync()
  useWindowTitleSync()
  useZoomWheel()

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && zenMode) {
        toggleZenMode()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [zenMode, toggleZenMode])

  return (
    <div className={`app${zenMode ? ' app--zen' : ''}`}>
      {!zenMode && <SidebarRail />}
      {!zenMode && <Sidebar />}
      <main className="main">
        <TabBar />
        <HeaderBar />
        <Toolbar />
        {/* The editor pane must stay mounted across tab switches; Welcome overlays when empty. */}
        <div className="main__content">
          <div className="editor-host" style={{ display: hasTabs ? 'block' : 'none' }}>
            <EditorPane />
          </div>
          {!hasTabs && <WelcomeView />}
        </div>
        {/* Along the bottom of the editor column, so it shares the width of the
            thing it is a terminal for rather than covering it. */}
        {!zenMode && <TerminalPanel />}
        {!zenMode && <StatusBar />}
      </main>
      {!zenMode && <RightPanel />}
      <GraphView />
      <AnalyticsView />
      <HistoryModal />
      <Palette />
      <SettingsModal />
      {/* Above everything: a server is waiting on each of these answers. */}
      <McpApprovalModal />
      <McpElicitModal />
      <McpSamplingModal />
      <McpPromptModal />
      <DocStatsModal />
      <MediaViewerModal />
      <ContextMenu />
      <Toast />
    </div>
  )
}
