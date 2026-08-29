import { z } from 'zod'
import type { McpServerConfig } from '@core/mcp-config'

/**
 * Persisted user settings. The zod schema is the single source of truth:
 * main validates on load/save, renderer gets the inferred type.
 * Bump `schemaVersion` and add a migration in SettingsStore when changing shape.
 */
/**
 * The right-hand panels, by name.
 *
 * Here rather than in the renderer's `SidePanel` union because two settings
 * store one — the panel that is open, and the panel a saved workspace restores
 * — and a name that reaches disk has to be validated on the way back in.
 */
export const sidePanelSchema = z.enum([
  'outline',
  'backlinks',
  'outgoing',
  'bookmarks',
  'search',
  'ai',
  'stats',
  'analysis',
  'tags',
  'git',
  'mcp'
])

/**
 * One MCP server, as it is written to disk.
 *
 * Typed against `McpServerConfig` from `core/` rather than inferred back out of
 * zod: the shape is a decision the pure module owns, and this is the boundary
 * that has to prove a file on disk still matches it.
 */
export const mcpServerSchema: z.ZodType<McpServerConfig> = z.union([
  z.object({
    id: z.string().min(1),
    name: z.string(),
    enabled: z.boolean().default(true),
    transport: z.literal('stdio'),
    command: z.string(),
    args: z.array(z.string()).default([]),
    env: z.record(z.string(), z.string()).default({}),
    cwd: z.string().default('')
  }),
  z.object({
    id: z.string().min(1),
    name: z.string(),
    enabled: z.boolean().default(true),
    transport: z.literal('http'),
    url: z.string(),
    headers: z.record(z.string(), z.string()).default({})
  })
])

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
      /**
       * Wrapping in code files, separately from prose.
       *
       * Off, because a wrapped line breaks the column alignment that
       * indentation, indent guides and ASCII tables all depend on. Prose wants
       * the opposite, which is why one setting could not serve both.
       */
      wordWrapCode: z.boolean().default(false),
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
      focusMode: z.boolean().default(false),
      /**
       * The scaled-down preview of the whole document beside the scrollbar.
       * On for code, where a file is long enough to get lost in; off for prose,
       * which is read by its headings and has the outline panel for that.
       */
      minimap: z.boolean().default(true),
      /** Vertical lines marking indentation depth, in code files. */
      indentGuides: z.boolean().default(true),
      /** Vim keybindings, in prose as well as code. */
      vimMode: z.boolean().default(false)
    })
    .prefault({}),
  markdown: z
    .object({
      /** Render formatting inline (headings, bold, links…) — the orrery signature. */
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
  /**
   * Named layouts, saved by hand and switched between.
   *
   * By path, not by buffer id: ids last a session, a workspace is meant to last
   * longer. A path that no longer resolves is dropped when it is restored.
   */
  workspaces: z
    .record(
      z.string(),
      z.object({
        openPaths: z.array(z.string()).default([]),
        panePaths: z.array(z.string()).default([]),
        activePath: z.string().default(''),
        focusedPane: z.number().int().min(0).default(0),
        sidePanel: sidePanelSchema.nullable().default(null)
      })
    )
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
      width: z.number().min(220).max(720).default(300),
      /**
       * Which side panel is open, or null for none. Remembered so closing it
       * sticks; the outline is the default because a note's own structure is
       * the most useful thing to see beside it on a first run.
       */
      panel: sidePanelSchema.nullable().default('outline')
    })
    .prefault({}),
  /**
   * Model Context Protocol: the servers Orrery talks to, and what they may do.
   *
   * Permissions are remembered per tool per server. They live here rather than
   * beside the server so that removing a server and adding it back does not
   * quietly restore what it was once allowed to do — `forgetServer` clears them
   * on removal, deliberately and visibly.
   */
  mcp: z
    .object({
      servers: z.array(mcpServerSchema).default([]),
      permissions: z
        .object({
          remembered: z.record(z.string(), z.enum(['allow', 'deny'])).default({})
        })
        .prefault({}),
      /** Tools switched off by the user, by `serverId/toolName`. */
      disabledTools: z.array(z.string()).default([]),
      /** How long to wait for a server before giving up on one call. */
      timeoutMs: z.number().int().min(1000).max(300_000).default(30_000),
      /** A tool result longer than this is trimmed before a model sees it. */
      maxResultChars: z.number().int().min(500).max(200_000).default(20_000)
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
  /** Files pinned by the user, newest first. Absolute paths. */
  bookmarks: z.array(z.string()).default([]),
  recentFiles: z.array(z.string()).default([]),
  recentFolders: z.array(z.string()).default([]),
  lastOpenedFolder: z.string().nullable().default(null)
})

export type Settings = z.infer<typeof settingsSchema>

export const defaultSettings: Settings = settingsSchema.parse({})
