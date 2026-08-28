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
  /**
   * Saves run one at a time.
   *
   * Every save wrote to the same `settings.json.tmp` and renamed it into
   * place. Two overlapping saves — a debounced one still in flight when
   * `flush()` runs on quit — therefore raced for one temp file: the first
   * rename consumed it and the second failed with ENOENT, which the app
   * reported on startup as "Failed to save settings".
   */
  private saving: Promise<void> = Promise.resolve()
  private tmpCounter = 0

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

  /** Persist immediately (used on quit), after any in-flight save. */
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

  private save(): Promise<void> {
    // Queued behind whatever is already writing. A failed write must not break
    // the chain for every save after it, so the link is always resolved.
    this.saving = this.saving.then(() => this.writeSettings())
    return this.saving
  }

  private async writeSettings(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      // Unique per write as well as serialised: a second process pointed at the
      // same directory would otherwise collide on the temp file too.
      const tmp = `${this.filePath}.${process.pid}.${(this.tmpCounter += 1)}.tmp`
      await fs.writeFile(tmp, JSON.stringify(this.settings, null, 2), 'utf-8')
      await fs.rename(tmp, this.filePath)
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
  }
}
