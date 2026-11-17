import { mkdirSync, promises as fs, renameSync, writeFileSync } from 'node:fs'
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
  /** Set by `flushSync`: the file on disk is final, and no later save may replace it. */
  private closed = false
  private listeners: ((changed: Partial<Settings>) => void)[] = []

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

  /**
   * Merge a patch in. `fromRenderer` marks a change the window asked for: it
   * already holds that change and is told the result in the reply, so
   * listeners are not called for it.
   */
  set(patch: Partial<Settings>, options: { fromRenderer?: boolean } = {}): Settings {
    const merged = settingsSchema.safeParse({ ...this.settings, ...patch })
    if (merged.success) {
      this.settings = merged.data
      this.scheduleSave()
      if (!options.fromRenderer && this.listeners.length > 0) {
        const changed = Object.fromEntries(
          Object.keys(patch).map((key) => [key, this.settings[key as keyof Settings]])
        ) as Partial<Settings>
        for (const listener of this.listeners) listener(changed)
      }
    }
    return this.settings
  }

  /**
   * Called when main changes settings on its own: a remembered MCP answer, the
   * host's token, the window's size, the zoom, the recent files. The listener
   * gets those keys only, with their values after the change.
   *
   * The window keeps a copy of the settings and patches whole top-level keys
   * built from it, so a copy that missed a change made here writes the old
   * value back over it. "Always allow" was recorded in main, never reached the
   * settings page, and the next edit on that page sent the stale `mcp` back,
   * erasing every answer remembered since launch, refusals included.
   *
   * Only the changed keys, not the whole settings. A push and the reply to the
   * window's own `settings:set` travel separately and can arrive in either
   * order, so a whole snapshot taken before the window's change could land
   * after it and undo it in the window's copy: the sidebar, a workspace, an
   * editor setting, and from there back into main on the next edit of that
   * key. Main changes keys the window does not edit while it does, so sending
   * just those cannot take anything back.
   */
  onChange(listener: (changed: Partial<Settings>) => void): void {
    this.listeners.push(listener)
  }

  /** Persist immediately (used on quit), after any in-flight save. */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    await this.save()
  }

  /**
   * Persist now, before returning, and refuse every write after this one.
   * For quitting, and only for quitting.
   *
   * Quitting used to call `flush()` without waiting for it, and nothing could
   * wait: the process exits once the quit handlers return, whatever is still
   * queued on the thread pool. A change made in the last moments before quit
   * was lost when the exit won. The tabs that were open are exactly that kind
   * of change, so on a slow machine a restart came back to the folder, saved
   * long before, without its tabs. Writing a few kilobytes synchronously costs
   * a millisecond.
   *
   * An async save already in flight serialised the settings when it started,
   * so if its rename landed after this write it would put older settings back.
   * `closed` stops it at the rename.
   */
  flushSync(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    this.closed = true
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.${process.pid}.${(this.tmpCounter += 1)}.tmp`
      writeFileSync(tmp, JSON.stringify(this.settings, null, 2), 'utf-8')
      renameSync(tmp, this.filePath)
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
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
      if (this.closed) {
        await fs.rm(tmp, { force: true })
        return
      }
      await fs.rename(tmp, this.filePath)
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
  }
}
