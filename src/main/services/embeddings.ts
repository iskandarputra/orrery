import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { chunkMarkdown } from '@core/chunk'
import { contentHash, planReindex, type IndexedChunk, type IndexedFile } from '@core/embed-index'
import { buildGraph } from '@core/graph'
import { selectContext } from '@core/retrieval'
import { noteCentroid, suggestLinks } from '@core/suggestions'
import { cosineSimilarity, topK } from '@core/vector'
import type { Settings } from '@shared/settings'
import type { BacklinkHit, LinkSuggestion } from '@shared/types'
import { IpcError } from '../ipc/errors'

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.svn', '.hg'])
const MAX_FILE_BYTES = 2 * 1024 * 1024
/** Embedding requests in flight at once — the model server is the bottleneck. */
const EMBED_CONCURRENCY = 8
const INDEX_VERSION = 2

interface IndexFile {
  version: number
  files: IndexedFile[]
}

interface VaultFile {
  path: string
  stem: string
  content: string
}

/**
 * Vault embedding index for semantic retrieval. Embeddings come from a local
 * Ollama model (Anthropic has no embeddings API) regardless of the chat
 * provider, so semantic search works offline. The index is a plain JSON file
 * per vault under userData — cheap, transparent, no native deps.
 *
 * Reindexing is incremental: each note is fingerprinted, and only notes whose
 * text actually changed are sent to the model. A vault re-scan after editing
 * one note costs one note's worth of embedding, not the whole vault's.
 */
export class EmbeddingService {
  constructor(
    private getSettings: () => Settings,
    private userDataDir: string
  ) {}

  private indexPath(rootPath: string): string {
    const hash = createHash('sha1').update(rootPath).digest('hex').slice(0, 16)
    return path.join(this.userDataDir, 'embeddings', `${hash}.json`)
  }

  /** Overridable so tests can drive the indexer without a model server. */
  protected async embed(text: string): Promise<number[]> {
    const { ai } = this.getSettings()
    const res = await fetch(`${ai.ollamaUrl.replace(/\/$/, '')}/api/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: ai.embedModel, prompt: text })
    }).catch(() => null)
    if (!res || !res.ok) {
      throw new IpcError(
        'UNKNOWN',
        `Embedding failed — is Ollama running at ${ai.ollamaUrl} with model "${ai.embedModel}"? (ollama pull ${ai.embedModel})`
      )
    }
    const data = (await res.json()) as { embedding?: number[] }
    if (!data.embedding?.length) throw new IpcError('UNKNOWN', 'Empty embedding response')
    return data.embedding
  }

  /** Every markdown note in the vault, with its text. */
  private async readVault(rootPath: string): Promise<VaultFile[]> {
    const files: VaultFile[] = []
    const walk = async (dir: string): Promise<void> => {
      let entries
      try {
        entries = await fs.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(full)
          continue
        }
        if (!entry.isFile() || !/\.(md|markdown|mdown|mkd)$/i.test(entry.name)) continue
        try {
          const stat = await fs.stat(full)
          if (stat.size > MAX_FILE_BYTES) continue
          files.push({
            path: full,
            stem: entry.name.replace(/\.[^.]+$/, ''),
            content: await fs.readFile(full, 'utf-8')
          })
        } catch {
          // skip unreadable
        }
      }
    }
    await walk(rootPath)
    return files
  }

  private async load(rootPath: string): Promise<IndexedFile[]> {
    try {
      const raw = JSON.parse(await fs.readFile(this.indexPath(rootPath), 'utf-8')) as
        IndexFile | IndexedChunk[]
      // A v1 index was a flat chunk array with no fingerprints — nothing to
      // reuse from it, so it is simply rebuilt on the next pass.
      if (Array.isArray(raw)) return []
      return raw.version === INDEX_VERSION ? raw.files : []
    } catch {
      return []
    }
  }

  private async save(rootPath: string, files: IndexedFile[]): Promise<void> {
    const target = this.indexPath(rootPath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, JSON.stringify({ version: INDEX_VERSION, files }), 'utf-8')
  }

  /** Embed one note's chunks, a bounded number of requests at a time. */
  private async embedFile(file: { path: string; content: string }): Promise<IndexedFile> {
    const chunks = chunkMarkdown(file.content)
    const embedded: IndexedChunk[] = []
    for (let start = 0; start < chunks.length; start += EMBED_CONCURRENCY) {
      const batch = chunks.slice(start, start + EMBED_CONCURRENCY)
      const vectors = await Promise.all(batch.map((chunk) => this.embed(chunk.text)))
      batch.forEach((chunk, i) => {
        embedded.push({ path: file.path, line: chunk.line, text: chunk.text, vector: vectors[i]! })
      })
    }
    return { path: file.path, hash: contentHash(file.content), chunks: embedded }
  }

  /**
   * Bring the index up to date. Only notes whose text changed are embedded;
   * `embedded` reports how many of them there were, so the UI can say what the
   * work actually was.
   */
  async reindex(
    rootPath: string
  ): Promise<{ files: number; chunks: number; embedded: number; reused: number }> {
    const vault = await this.readVault(rootPath)
    const plan = planReindex(vault, await this.load(rootPath))

    const indexed = [...plan.reuse]
    for (const file of plan.embed) {
      indexed.push(await this.embedFile(file))
    }
    indexed.sort((a, b) => a.path.localeCompare(b.path))

    await this.save(rootPath, indexed)
    return {
      files: indexed.length,
      chunks: indexed.reduce((sum, file) => sum + file.chunks.length, 0),
      embedded: plan.embed.length,
      reused: plan.reuse.length
    }
  }

  /**
   * Semantic search, widened by the link graph: passages are ranked by meaning,
   * then notes linked from the strongest hits get a small edge, so the note that
   * *explains* the best match comes along with it. Empty if there is no index.
   */
  async search(rootPath: string, query: string, k: number): Promise<BacklinkHit[]> {
    const files = await this.load(rootPath)
    const chunks = files.flatMap((file) => file.chunks)
    if (chunks.length === 0) return []

    const q = await this.embed(query)
    // Score generously, then let the graph decide the final cut: a chunk that
    // just missed on text alone can still be the right context.
    const scored = topK(chunks, (c) => cosineSimilarity(q, c.vector), Math.max(k * 4, 24)).map(
      (c) => ({
        path: c.path,
        line: c.line,
        text: c.text,
        score: cosineSimilarity(q, c.vector)
      })
    )

    return selectContext({ chunks: scored, graph: this.graphFromIndex(files), k }).map((c) => ({
      path: c.path,
      line: c.line,
      snippet: c.text.replace(/\s+/g, ' ').slice(0, 200)
    }))
  }

  /**
   * The link graph rebuilt from indexed text rather than from disk — a chat
   * question shouldn't cost a full vault read. Chunking preserves the note body
   * apart from whitespace, so the [[wikilinks]] it needs are all still there.
   */
  private graphFromIndex(files: IndexedFile[]): ReturnType<typeof buildGraph> {
    return buildGraph(
      files.map((file) => ({
        path: file.path,
        stem: file.path.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, ''),
        content: file.chunks.map((chunk) => chunk.text).join('\n\n')
      }))
    )
  }

  /**
   * Links the vault is missing for one note: notes about the same thing that it
   * doesn't link to yet. Needs no model call — both the vectors and the link
   * graph are already on hand.
   */
  async suggestLinks(rootPath: string, notePath: string, limit: number): Promise<LinkSuggestion[]> {
    const files = await this.load(rootPath)
    if (files.length === 0) return []

    const vectors = new Map<string, number[]>(
      files.map((file) => [file.path, noteCentroid(file.chunks.map((chunk) => chunk.vector))])
    )
    const vault = await this.readVault(rootPath)
    return suggestLinks({
      from: notePath,
      vectors,
      graph: buildGraph(vault, rootPath),
      limit
    })
  }
}
