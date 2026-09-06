import { useStore } from '@/state/store'
import { NumberField, SettingRow, Toggle } from '../controls'

export function GeneralSection(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const forgetAllHtmlTrust = useStore((s) => s.forgetAllHtmlTrust)
  const g = settings.general
  const remembered = Object.keys(settings.htmlTrust).length

  return (
    <>
      <h3 className="set-group">Files</h3>
      <SettingRow label="Autosave" description="Save documents automatically after you stop typing">
        <Toggle
          checked={g.autosave}
          onChange={(autosave) => update({ general: { ...g, autosave } })}
        />
      </SettingRow>
      {g.autosave && (
        <SettingRow label="Autosave delay" description="Idle time before an automatic save">
          <NumberField
            value={g.autosaveDelay}
            min={250}
            max={30000}
            step={250}
            suffix="ms"
            onChange={(autosaveDelay) => update({ general: { ...g, autosaveDelay } })}
          />
        </SettingRow>
      )}
      <h3 className="set-group">Startup</h3>
      <SettingRow
        label="Restore last folder"
        description="Reopen the previous workspace when orrery starts"
      >
        <Toggle
          checked={g.restoreLastFolder}
          onChange={(restoreLastFolder) => update({ general: { ...g, restoreLastFolder } })}
        />
      </SettingRow>
      <h3 className="set-group">Web pages</h3>
      <SettingRow
        label="Run scripts in HTML files"
        description="Read a page with its own code already running, instead of being asked each time. Nothing is ever fetched from the internet without asking, and code from the internet never runs."
      >
        <Toggle
          checked={settings.html.runScripts}
          onChange={(runScripts) => update({ html: { ...settings.html, runScripts } })}
        />
      </SettingRow>
      <SettingRow
        label="Remembered pages"
        description={
          remembered === 0
            ? 'No page has been allowed to run its own code or fetch its remote content'
            : `${remembered} page${remembered === 1 ? ' has' : 's have'} been allowed to run their own code or fetch their remote content. Each is remembered against the file it was, so one whose contents change asks again.`
        }
      >
        <button className="btn" disabled={remembered === 0} onClick={forgetAllHtmlTrust}>
          Forget all
        </button>
      </SettingRow>
    </>
  )
}
