import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@/services/client'
import { allServers } from '@core/lsp-servers'
import { SettingRow } from '../controls'

/**
 * Language servers, and whether this machine has them.
 *
 * Servers are found on PATH rather than bundled — bundling one would add tens
 * of megabytes to every install and still cover only a single language family.
 * The cost of that choice is that a language with nothing installed does
 * nothing at all, so this is where it says so, with the command that fixes it.
 */
export function LanguageServersSection(): React.JSX.Element {
  const [installed, setInstalled] = useState<Record<string, boolean> | null>(null)
  /** Bumped to ask again; the lookup itself belongs in an effect, not a click. */
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    invoke('lsp:installed', undefined)
      .then((found) => live && setInstalled(found))
      .catch(() => live && setInstalled({}))
    return () => {
      live = false
    }
  }, [attempt])

  const refresh = useCallback((): void => {
    setInstalled(null)
    setAttempt((n) => n + 1)
  }, [])

  return (
    <>
      <h3 className="set-group">Language servers</h3>
      <p className="set-note">
        Orrery talks to language servers already installed on this machine; it does not bundle them.
        A language with no server still gets syntax highlighting, brackets and folding — it just
        gets no diagnostics.
      </p>
      {allServers().map((server) => {
        const state = installed?.[server.languageId]
        return (
          <SettingRow
            key={server.languageId}
            label={server.label}
            description={
              state === true
                ? `Found: ${server.command}`
                : state === false
                  ? `Not installed — ${server.install}`
                  : 'Checking…'
            }
          >
            <span className={`lsp-pill${state ? ' lsp-pill--on' : ''}`}>
              {state === undefined ? '…' : state ? 'Detected' : 'Missing'}
            </span>
          </SettingRow>
        )
      })}
      <SettingRow label="Re-check" description="Look for servers on PATH again">
        <button className="btn" onClick={refresh}>
          Re-check
        </button>
      </SettingRow>
    </>
  )
}
