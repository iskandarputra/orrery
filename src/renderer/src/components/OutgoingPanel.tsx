import { useMemo } from 'react'
import { basename } from '@core/paths'
import { resolveNote } from '@core/notes'
import { findWikilinks } from '@core/wikilinks'
import { getActiveView } from '@/editor/active-view'
import { activeFilePath } from '@/state/app-state'
import { useDocVersion } from '@/state/doc-version'
import { useStore } from '@/state/store'
import { Icon } from './Icon'
import { EmptyState } from './PanelBits'

/**
 * What this note points at: the inverse of backlinks.
 *
 * Read from the document rather than from the vault index, so a link typed a
 * second ago is listed before it has been saved. Targets that resolve to
 * nothing are shown as missing rather than hidden, because a link to a note you
 * have not written is the most useful thing this panel can tell you: it is
 * either a typo or the next note to write.
 */
export function OutgoingBody(): React.JSX.Element {
  const noteIndex = useStore((s) => s.noteIndex)
  const openPaths = useStore((s) => s.openPaths)
  const activeId = useStore((s) => s.activeId)
  const activePath = useStore((s) =>
    s.activeId ? (s.buffers[s.activeId]?.filePath ?? null) : null
  )
  const fromPath = useStore(activeFilePath)
  // Recomputed as the document changes. `useDocVersion` is the signal built for
  // exactly this: a counter per buffer, bumped on every edit, including one the
  // panel did not make.
  const version = useDocVersion((v) => (activeId ? (v[activeId] ?? 0) : 0))

  const links = useMemo(() => {
    const view = getActiveView()
    if (!activeId || !view) return []
    const doc = view.state.doc
    const seen = new Set<string>()
    return findWikilinks(doc.toString())
      .filter((link) => {
        const key = `${link.target}#${link.heading ?? ''}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .map((link) => ({
        target: link.target,
        heading: link.heading,
        embed: link.embed,
        line: doc.lineAt(link.from).number,
        resolved: resolveNote(noteIndex, link.target, fromPath)
      }))
    // `version` is the trigger rather than an input: the document it stands for
    // is read imperatively through `getActiveView` above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, noteIndex, fromPath, version])

  if (!activePath) return <EmptyState icon="link">Open a note to see what it links to.</EmptyState>
  if (links.length === 0)
    return (
      <EmptyState icon="link">
        This note links to nothing yet. Point it at another with <code>[[Note]]</code>.
      </EmptyState>
    )

  const missing = links.filter((l) => !l.resolved).length

  return (
    <div className="outgoing">
      <div className="rpanel-count">
        <span className="rpanel-count__badge">{links.length}</span> link
        {links.length === 1 ? '' : 's'}
        {missing > 0 && <span className="outgoing__missing-count"> · {missing} missing</span>}
      </div>
      {links.map((link) => (
        <button
          key={`${link.target}#${link.heading ?? ''}`}
          className={`outgoing__row${link.resolved ? '' : ' outgoing__row--missing'}`}
          title={link.resolved ? link.resolved.path : `${link.target} does not exist yet`}
          onClick={() => link.resolved && void openPaths([link.resolved.path])}
        >
          <Icon name={link.embed ? 'layers' : 'link'} size={13} className="outgoing__icon" />
          <span className="outgoing__name">
            {link.target}
            {link.heading && <span className="outgoing__heading"># {link.heading}</span>}
          </span>
          <span className="outgoing__meta">
            {link.resolved ? basename(link.resolved.path) : 'missing'} · {link.line}
          </span>
        </button>
      ))}
    </div>
  )
}
