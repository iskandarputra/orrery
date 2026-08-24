import { promises as fs } from 'node:fs'
import path from 'node:path'
import { defaultSettings, settingsSchema, type Settings } from '@shared/settings'

const SAVE_DEBOUNCE_MS = 300

/**
 * JSON settings persisted under userData, validated with zod on load so a
 * corrupt or outdated file degrades to defaults instead of crashing the app.
 * Writes are debounced and atomic.
 */
export class SettingsStore {
  private settings: Settings = defaultSettings
  private saveTimer: NodeJS.Timeout | null = null
  private readonly filePath: string

  constructor(userDataDir: string) {
    this.filePath = path.join(userDataDir, 'settings.json')
  }

  async load(): Promise<Settings> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      const parsed = settingsSchema.safeParse(JSON.parse(raw))
      this.settings = parsed.success ? parsed.data : defaultSettings
    } catch {
      this.settings = defaultSettings
    }
    return this.settings
  }

  get(): Settings {
    return this.settings
  }

  set(patch: Partial<Settings>): Settings {
    const merged = settingsSchema.safeParse({ ...this.settings, ...patch })
    if (merged.success) {
      this.settings = merged.data
      this.scheduleSave()
    }
    return this.settings
  }

  /** Persist immediately (used on quit). */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    await this.save()
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.save()
    }, SAVE_DEBOUNCE_MS)
  }

  private async save(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.tmp`
      await fs.writeFile(tmp, JSON.stringify(this.settings, null, 2), 'utf-8')
      await fs.rename(tmp, this.filePath)
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
  }
}
