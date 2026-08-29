import { useStore } from '@/state/store'
import { NumberField, SettingRow, Toggle } from '../controls'

export function GeneralSection(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const g = settings.general

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
    </>
  )
}
