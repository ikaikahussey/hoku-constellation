#!/usr/bin/env -S npx tsx --tsconfig tsconfig.scripts.json
/**
 * Embedding backfill — a separate job from ingestion. Fills document.embedding and summary.embedding
 * (vector(1024)) for rows that have text but no embedding, in batches, with a resumable cursor in
 * import_cursor (source = 'embeddings:document' / 'embeddings:summary').
 *
 * Provider: any OpenAI-compatible embeddings endpoint (EMBEDDING_API_URL, EMBEDDING_API_KEY,
 * EMBEDDING_MODEL). Output dimension must be 1024 (e.g. voyage-3 / voyage-law-2 at 1024,
 * text-embedding-3-large with dimensions=1024). Input is truncated to EMBEDDING_MAX_CHARS (default 6000).
 *
 *   npx tsx --tsconfig tsconfig.scripts.json scripts/embeddings/backfill.ts [--table=document|summary] [--limit=N] [--batch=32] [--dry]
 */
import { getServiceDb, closeServiceDb } from '@/lib/db/service'
import type { Db } from '@/lib/db/types'
import { getCursor, setCursor } from '@/lib/import/pipeline'

const DIM = 1024
const MAX_CHARS = Number(process.env.EMBEDDING_MAX_CHARS ?? 6000)

export type Embedder = (texts: string[]) => Promise<number[][]>

export function openAiCompatibleEmbedder(): Embedder {
  const url = process.env.EMBEDDING_API_URL, key = process.env.EMBEDDING_API_KEY, model = process.env.EMBEDDING_MODEL
  if (!url || !key || !model) throw new Error('EMBEDDING_API_URL, EMBEDDING_API_KEY and EMBEDDING_MODEL are required')
  return async (texts) => {
    const res = await fetch(url, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model, input: texts, dimensions: DIM, output_dimension: DIM }) })
    if (!res.ok) throw new Error(`embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const json = await res.json() as { data: Array<{ index: number; embedding: number[] }> }
    const out = json.data.sort((a, b) => a.index - b.index).map(d => d.embedding)
    for (const v of out) if (v.length !== DIM) throw new Error(`embedding dimension ${v.length}, expected ${DIM}`)
    return out
  }
}

/** Text that represents a document for retrieval: title + body (or the canonical raw record when there is no body). */
export function documentText(row: { title: string | null; body_text: string | null; doc_type: string; source: string; raw: unknown }): string {
  const body = row.body_text?.trim() || JSON.stringify(row.raw).slice(0, MAX_CHARS)
  return `${row.doc_type} (${row.source})\n${row.title ?? ''}\n${body}`.slice(0, MAX_CHARS)
}

export async function backfill(db: Db, table: 'document' | 'summary', embed: Embedder, opts: { limit?: number; batch?: number; dry?: boolean; log?: (m: string) => void } = {}) {
  const log = opts.log ?? (() => {})
  const batch = opts.batch ?? 32
  const source = `embeddings:${table}`
  let done = 0
  const cursor = await getCursor(db, source)
  if (!opts.dry) await setCursor(db, source, cursor.cursor_offset, 'running')
  for (;;) {
    if (opts.limit != null && done >= opts.limit) break
    const n = Math.min(batch, opts.limit != null ? opts.limit - done : batch)
    const rows = table === 'document'
      ? await db.many<{ id: string; title: string | null; body_text: string | null; doc_type: string; source: string; raw: unknown }>(
          `select id, title, body_text, doc_type, source, raw from document where embedding is null and (body_text is not null or title is not null) order by fetched_at, id limit $1`, [n])
      : await db.many<{ id: string; body: string }>(`select id, body from summary where embedding is null and body is not null order by created_at, id limit $1`, [n])
    if (!rows.length) break
    const texts = rows.map(r => 'body' in r ? r.body.slice(0, MAX_CHARS) : documentText(r))
    if (opts.dry) { log(`[dry] would embed ${rows.length} ${table} rows`); done += rows.length; if (rows.length < n) break; continue }
    const vectors = await embed(texts)
    for (let i = 0; i < rows.length; i++) {
      await db.query(`update ${table} set embedding = $2::vector where id = $1`, [rows[i].id, `[${vectors[i].join(',')}]`])
    }
    done += rows.length
    await setCursor(db, source, cursor.cursor_offset + done, 'running', { last_batch: rows.length })
    log(`embedded ${done} ${table} rows`)
    if (rows.length < n) break
  }
  if (!opts.dry) await setCursor(db, source, cursor.cursor_offset + done, 'complete')
  return done
}

async function main() {
  const args = process.argv.slice(2)
  const get = (f: string) => { const a = args.find(x => x.startsWith(`--${f}=`)); return a ? a.split('=')[1] : undefined }
  const dry = args.includes('--dry')
  const tables = (get('table') ? [get('table')!] : ['document', 'summary']) as Array<'document' | 'summary'>
  const db = await getServiceDb()
  try {
    const embed = dry ? async (t: string[]) => t.map(() => new Array(DIM).fill(0)) : openAiCompatibleEmbedder()
    for (const t of tables) {
      const n = await backfill(db, t, embed, { limit: get('limit') ? Number(get('limit')) : undefined, batch: get('batch') ? Number(get('batch')) : undefined, dry, log: console.log })
      console.log(`${t}: ${n} row(s) ${dry ? 'would be ' : ''}embedded`)
    }
  } finally { await closeServiceDb() }
}

if (process.argv[1]?.endsWith('backfill.ts')) main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
