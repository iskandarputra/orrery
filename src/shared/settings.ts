import { z } from 'zod'

/**
 * Persisted user settings. The zod schema is the single source of truth:
 * main validates on load/save, renderer gets the inferred type.
 * Bump `schemaVersion` and add a migration in SettingsStore when changing shape.
 */
export const settingsSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  /** Appearance mode; the concrete palette comes from lightTheme/darkTheme. */
  theme: z.enum(['light', 'dark', 'system']).default('system'),
  lightTheme: z.string().default('zinc-light'),
  /**
   * Raise the theme's code colours until they meet WCAG AA on the code
   * surface. Off by default: the seven code colours are each theme's upstream
   * palette, and most of those palettes are under AA as published.
   */
  highContrastCode: z.boolean().default(false),
  darkTheme: z.string().default('zinc-dark'),
  general: z
    .object({
      autosave: z.boolean().default(false),
      autosaveDelay: z.number().int().min(250).max(30000).default(1500),
      restoreLastFolder: z.boolean().default(true)
    })
    .prefault({}),
  editor: z
    .object({
      fontSize: z.number().min(8).max(48).default(16),
      fontFamily: z.string().default(''),
      lineHeight: z.number().min(1).max(3).default(1.7),
      tabSize: z.number().int().min(1).max(8).default(2),
      wordWrap: z.boolean().default(true),
      lineNumbers: z.boolean().default(false),
      highlightActiveLine: z.boolean().default(true),
      /** Editing canvas width: readable column presets, full-bleed, or custom. */
      lineWidth: z.enum(['narrow', 'normal', 'wide', 'full', 'custom']).default('normal'),
      /** Only used when lineWidth is 'custom' (px). */
      customLineWidth: z.number().int().min(400).max(3000).default(900),
      /**
       * View mode: 'source' = raw markdown (edit), 'live' = inline rendering
       * while editing (hybrid), 'reading' = fully rendered and read-only (view).
       */
      viewMode: z.enum(['source', 'live', 'reading']).default('live'),
      /** Keep the caret line vertically centered while typing. */
      typewriter: z.boolean().default(false),
      /** Dim everything except the paragraph being edited. */
      focusMode: z.boolean().default(false)
    })
    .prefault({}),
  markdown: z
    .object({
      /** Render formatting inline (headings, bold, links…) — the zymd signature. */
      livePreview: z.boolean().default(true),
      /** Replace -,*,+ markers with round bullets. */
      fancyBullets: z.boolean().default(true),
      /** Render [ ]/[x] as clickable checkboxes. */
      interactiveCheckboxes: z.boolean().default(true),
      /** Render ![alt](path) and ![[embed]] as inline images. */
      showImages: z.boolean().default(true),
      /** Vault folder pasted and dropped images are filed into. */
      assetFolder: z.string().default('assets'),
      /**
       * Reflow soft-wrapped paragraph lines to fill the canvas width, like a
       * markdown preview — single newlines within a paragraph render as spaces.
       */
      reflowParagraphs: z.boolean().default(true)
    })
    .prefault({}),
  /** Restored on the next launch so a restart doesn't cost your working set. */
  session: z
    .object({
      openPaths: z.array(z.string()).default([]),
      activePath: z.string().default('')
    })
    .prefault({}),
  /** Daily notes: one dated note per day, optionally from a template. */
  dailyNotes: z
    .object({
      /** Folder inside the vault; empty means the vault root. */
      folder: z.string().default('Daily'),
      /** Filename date format — the same tokens templates use. */
      format: z.string().default('YYYY-MM-DD'),
      /** Vault-relative path of the template to seed new daily notes with. */
      template: z.string().default('')
    })
    .prefault({}),
  templates: z
    .object({
      /** Folder inside the vault holding template notes. */
      folder: z.string().default('Templates')
    })
    .prefault({}),
  ai: z
    .object({
      provider: z.enum(['none', 'claude', 'ollama', 'openai-compatible']).default('none'),
      /** Claude API key (stored locally in settings.json). */
      apiKey: z.string().default(''),
      model: z.string().default('claude-sonnet-5'),
      ollamaUrl: z.string().default('http://localhost:11434'),
      ollamaModel: z.string().default('llama3.1'),
      /**
       * Any OpenAI-compatible chat endpoint — DeepSeek, Groq, OpenRouter,
       * Together, LM Studio, vLLM. Base URL only; the service appends the
       * `/chat/completions` path.
       */
      compatUrl: z.string().default('https://api.deepseek.com'),
      compatKey: z.string().default(''),
      compatModel: z.string().default('deepseek-chat'),
      /** Use vault embeddings for retrieval instead of keyword search. */
      semanticSearch: z.boolean().default(false),
      /** Ollama embedding model used by reindex/semantic search. */
      embedModel: z.string().default('nomic-embed-text')
    })
    .prefault({}),
  sidebar: z
    .object({
      visible: z.boolean().default(true),
      width: z.number().min(160).max(600).default(260)
    })
    .prefault({}),
  rightPanel: z
    .object({
      width: z.number().min(220).max(720).default(300)
    })
    .prefault({}),
  window: z
    .object({
      width: z.number().default(1200),
      height: z.number().default(800),
      x: z.number().optional(),
      y: z.number().optional()
    })
    .prefault({}),
  /** Accelerator overrides by command id (e.g. "file.save": "CmdOrCtrl+S"). */
  keybindings: z.record(z.string(), z.string()).default({}),
  recentFiles: z.array(z.string()).default([]),
  recentFolders: z.array(z.string()).default([]),
  lastOpenedFolder: z.string().nullable().default(null)
})

export type Settings = z.infer<typeof settingsSchema>

export const defaultSettings: Settings = settingsSchema.parse({})
