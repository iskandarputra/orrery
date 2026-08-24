import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { chunkMarkdown } from '@core/chunk'
import { cosineSimilarity, topK } from '@core/vector'
import type { Settings } from '@shared/settings'
import type { BacklinkHit } from '@shared/types'
import { IpcError } from '../ipc/errors'

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.svn', '.hg'])
const MAX_FILE_BYTES = 2 * 1024 * 1024

interface IndexedChunk {
  path: string
  line: number
  text: string
  vector: number[]
}

/**
 * Vault embedding index for semantic retrieval. Embeddings come from a local
 * Ollama model (Anthropic has no embeddings API) regardless of the chat
 * provider, so semantic search works offline. The index is a plain JSON file
 * per vault under userData — cheap, transparent, no native deps.
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

  private async embed(text: string): Promise<number[]> {
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

  /** Rebuild the whole index. Returns how many chunks were embedded. */
  async reindex(rootPath: string): Promise<{ files: number; chunks: number }> {
    const files: string[] = []
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
        if (entry.isDirectory()) await walk(full)
        else if (entry.isFile() && /\.(md|markdown|mdown|mkd)$/i.test(entry.name)) files.push(full)
      }
    }
    await walk(rootPath)

    const index: IndexedChunk[] = []
    for (const file of files) {
      try {
        const stat = await fs.stat(file)
        if (stat.size > MAX_FILE_BYTES) continue
        const content = await fs.readFile(file, 'utf-8')
        for (const chunk of chunkMarkdown(content)) {
          index.push({
            path: file,
            line: chunk.line,
            text: chunk.text,
            vector: await this.embed(chunk.text)
          })
        }
      } catch (err) {
        if (err instanceof IpcError) throw err // provider error — abort with a clear message
      }
    }

    const target = this.indexPath(rootPath)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, JSON.stringify(index), 'utf-8')
    return { files: files.length, chunks: index.length }
  }

  /** Semantic search; empty result if there is no index yet. */
  async search(rootPath: string, query: string, k: number): Promise<BacklinkHit[]> {
    let index: IndexedChunk[]
    try {
      index = JSON.parse(await fs.readFile(this.indexPath(rootPath), 'utf-8'))
    } catch {
      return []
    }
    if (index.length === 0) return []
    const q = await this.embed(query)
    return topK(index, (c) => cosineSimilarity(q, c.vector), k).map((c) => ({
      path: c.path,
      line: c.line,
      snippet: c.text.replace(/\s+/g, ' ').slice(0, 200)
    }))
  }
}
