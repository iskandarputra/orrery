import { useEffect } from 'react'
import { invoke } from '@/services/client'
import { useStore } from '@/state/store'
import { ContextMenu } from '@/components/context-menu/ContextMenu'
import { DocStatsModal } from '@/components/DocStatsModal'
import { EditorPane } from '@/components/EditorPane'
import { AnalyticsView } from './components/AnalyticsView'
import { HistoryModal } from './components/HistoryModal'
import { GraphView } from '@/components/GraphView'
import { HeaderBar } from '@/components/HeaderBar'
import { Palette } from '@/components/Palette'
import { RightPanel } from '@/components/RightPanel'
import { SettingsModal } from '@/components/settings/SettingsModal'
import { Sidebar } from '@/components/Sidebar'
import { StatusBar } from '@/components/StatusBar'
import { TabBar } from '@/components/TabBar'
import { Toast } from '@/components/Toast'
import { Toolbar } from '@/components/Toolbar'
import { WelcomeView } from '@/components/WelcomeView'

function useThemeSync(): void {
  const mode = useStore((s) => s.settings.theme)
  const lightTheme = useStore((s) => s.settings.lightTheme)
  const darkTheme = useStore((s) => s.settings.darkTheme)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const appearance = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode
      document.documentElement.dataset['theme'] = appearance === 'dark' ? darkTheme : lightTheme
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [mode, lightTheme, darkTheme])
}

function useWindowTitleSync(): void {
  const active = useStore((s) => (s.activeId ? s.buffers[s.activeId] : null))
  useEffect(() => {
    const title = active ? `${active.isDirty ? '● ' : ''}${active.fileName} — zymd` : 'zymd'
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
        {!zenMode && <StatusBar />}
      </main>
      {!zenMode && <RightPanel />}
      <GraphView />
      <AnalyticsView />
      <HistoryModal />
      <Palette />
      <SettingsModal />
      <DocStatsModal />
      <ContextMenu />
      <Toast />
    </div>
  )
}
