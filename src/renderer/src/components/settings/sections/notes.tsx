import { useStore } from '@/state/store'
import { SettingRow, TextField } from '../controls'

/** Daily notes and templates — where dated notes land and what seeds them. */
export function NotesSection(): React.JSX.Element {
  const settings = useStore((s) => s.settings)
  const update = useStore((s) => s.updateSettings)
  const daily = settings.dailyNotes
  const templates = settings.templates

  return (
    <>
      <h3 className="set-group">Daily notes</h3>
      <SettingRow
        label="Folder"
        description="Where dated notes are created; blank puts them in the vault root"
      >
        <TextField
          value={daily.folder}
          placeholder="Daily"
          onChange={(folder) => update({ dailyNotes: { ...daily, folder } })}
        />
      </SettingRow>
      <SettingRow
        label="Filename format"
        description="YYYY MM DD HH mm · also MMMM and dddd for names"
      >
        <TextField
          value={daily.format}
          placeholder="YYYY-MM-DD"
          onChange={(format) => update({ dailyNotes: { ...daily, format } })}
        />
      </SettingRow>
      <SettingRow label="Template" description="Vault-relative note used for new daily notes">
        <TextField
          value={daily.template}
          placeholder="Templates/Daily.md"
          onChange={(template) => update({ dailyNotes: { ...daily, template } })}
        />
      </SettingRow>

      <h3 className="set-group">Templates</h3>
      <SettingRow label="Folder" description="Notes here appear in the template picker">
        <TextField
          value={templates.folder}
          placeholder="Templates"
          onChange={(folder) => update({ templates: { ...templates, folder } })}
        />
      </SettingRow>
      <p className="set-note">
        Placeholders: <code>{'{{title}}'}</code> <code>{'{{date}}'}</code> <code>{'{{time}}'}</code>{' '}
        <code>{'{{date:dddd}}'}</code> <code>{'{{date+1d}}'}</code> and <code>{'{{cursor}}'}</code>{' '}
        for where the caret lands.
      </p>
    </>
  )
}

/**
 * Language servers, and whether this machine has them.
 *
 * Servers are found on PATH rather than bundled — bundling one would add tens
 * of megabytes to every install and still cover only a single language family.
 * The cost of that choice is that a language with nothing installed does
 * nothing at all, so this is where it says so, with the command that fixes it.
 */
