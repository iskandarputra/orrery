import { useCallback, useEffect, useState } from 'react'
import type { BacklinkHit } from '@shared/types'
import { stem } from '@core/paths'
import { invoke } from '@/services/client'
import { useStore } from '@/state/store'
import { EmptyState, ResultGroups } from './PanelBits'

/** Notes linking to the active note — rendered inside the right panel. */
export function BacklinksBody(): React.JSX.Element {
  const rootPath = useStore((s) => s.rootPath)
  const activePath = useStore((s) =>
    s.activeId ? (s.buffers[s.activeId]?.filePath ?? null) : null
  )
  const openPaths = useStore((s) => s.openPaths)
  const withCode = useStore((s) => s.settings.graph.includeCode)
  const [result, setResult] = useState<{ key: string; hits: BacklinkHit[] } | null>(null)

  const scanKey = `${rootPath}|${activePath}|${withCode}`

  const scan = useCallback((): void => {
    if (!rootPath || !activePath) return
    const key = `${rootPath}|${activePath}|${withCode}`
    void invoke('workspace:scanLinks', { rootPath, targetPath: activePath, withCode })
      .then((hits) => setResult({ key, hits }))
      .catch(() => setResult({ key, hits: [] }))
  }, [rootPath, activePath, withCode])

  useEffect(() => scan(), [scan])

  const fresh = result?.key === scanKey ? result.hits : null

  if (!activePath) return <EmptyState icon="link">Open a note to see what links to it.</EmptyState>
  if (fresh === null) return <EmptyState icon="link">Scanning…</EmptyState>
  if (fresh.length === 0)
    return (
      <EmptyState icon="link">
        Nothing links to <strong>{stem(activePath)}</strong> yet. Reference it with{' '}
        <code>[[{stem(activePath)}]]</code>.
        {withCode
          ? null
          : ' Imports are not included. Turn on code in the graph settings to see them.'}
      </EmptyState>
    )
  return (
    <>
      <div className="rpanel-count">
        {fresh.length} backlink{fresh.length === 1 ? '' : 's'}
      </div>
      <ResultGroups hits={fresh} onOpen={(path) => void openPaths([path])} />
    </>
  )
}
