import type { BacklinkHit } from '@shared/types'
import { basename } from '@core/paths'
import { Icon, type IconName } from './Icon'

/** Centered empty/hint state shared by every right-panel tab. */
export function EmptyState({
  icon,
  children
}: {
  icon: IconName
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="rpanel-empty">
      <Icon name={icon} size={26} className="rpanel-empty__icon" />
      <p>{children}</p>
    </div>
  )
}

/** Hits grouped by file, with clickable file headers and line snippets. */
export function ResultGroups({
  hits,
  onOpen
}: {
  hits: BacklinkHit[]
  /** `hit` is given so a result that knows its page can be opened at it. */
  onOpen(path: string, hit?: BacklinkHit): void
}): React.JSX.Element {
  const grouped = new Map<string, BacklinkHit[]>()
  for (const h of hits) {
    const list = grouped.get(h.path)
    if (list) list.push(h)
    else grouped.set(h.path, [h])
  }
  return (
    <>
      {[...grouped.entries()].map(([path, fileHits]) => (
        <div key={path} className="result-group">
          <button className="result-group__file" title={path} onClick={() => onOpen(path)}>
            <Icon name="file-text" size={13} className="tree-icon" />
            <span className="result-group__name">{basename(path)}</span>
            <span className="result-group__count">{fileHits.length}</span>
          </button>
          {fileHits.map((hit, i) => (
            <button
              key={i}
              className="result-snippet"
              title={hit.page ? `${path}, page ${hit.page}` : `${path}:${hit.line}`}
              onClick={() => onOpen(path, hit)}
            >
              {/* A document with pages says which page; everything else says
                  which line, as it always has. */}
              <span className="result-snippet__line">{hit.page ? `p${hit.page}` : hit.line}</span>
              <span className="result-snippet__text">{hit.snippet}</span>
              {hit.ambiguous && (
                <span
                  className="result-snippet__ambiguous"
                  title="More than one file matched this name; the nearest one was picked."
                >
                  ambiguous
                </span>
              )}
            </button>
          ))}
        </div>
      ))}
    </>
  )
}
