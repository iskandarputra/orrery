import { injectThemeCss } from '@/themes/themes'
import { useEffect } from 'react'
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
