/**
 * Re-tags stored news articles when the tagging rules change (TAGGER_VERSION in lib/news/tagger.ts).
 *
 * The news importer tags an article once, when it is first stored; a re-run of an unchanged feed does
 * not revisit it. This pass walks every article in id order (cursor in import_cursor 'news_retag':
 * metadata.version and metadata.after) and applies the current tagger:
 *   - a new tag is inserted as a `mentioned_in` edge;
 *   - an existing edge for the same name and role that was in review or unmatched is updated in place
 *     when the name now resolves (or its candidates changed). Matched edges are never changed or removed,
 *     so staff decisions and alert history stay intact.
 * When the version changes the walk starts again from the first article.
 */
import type { Db } from '@/lib/db/types'
import { tagArticle, TAGGER_VERSION } from './tagger'
import { mentionEdge, hstDate } from '@/lib/import/sources/news'
import { insertEdge } from '@/lib/import/pipeline'

export const RETAG_SOURCE = 'news_retag'

export interface RetagResult { articles: number; inserted: number; updated: number; errors: number; done: boolean }

export async function retagArticles(db: Db, opts: { limit?: number; deadlineMs?: number; log?: (m: string) => void } = {}): Promise<RetagResult> {
  const log = opts.log ?? (() => {})
  const cursor = await db.one<{ metadata: { version?: number; after?: string } | null }>(`select metadata from import_cursor where source = $1`, [RETAG_SOURCE])
  const fresh = cursor?.metadata?.version !== TAGGER_VERSION
  let after = fresh ? '00000000-0000-0000-0000-000000000000' : (cursor?.metadata?.after ?? '00000000-0000-0000-0000-000000000000')
  const out: RetagResult = { articles: 0, inserted: 0, updated: 0, errors: 0, done: false }
  const rows = await db.many<{ id: string; title: string | null; body_text: string | null; description: string | null; published: string | null; outlet: string | null }>(
    `select id, title, body_text, raw ->> 'description' description, raw ->> 'published' published, raw ->> 'outlet' outlet
       from document where source = 'news' and doc_type = 'article' and id > $1 order by id limit $2`, [after, opts.limit ?? 200])
  for (const a of rows) {
    if (opts.deadlineMs && Date.now() >= opts.deadlineMs) break
    try {
      const mentions = await tagArticle(db, { title: a.title ?? '', body: a.body_text ?? a.description, published: a.published })
      for (const m of mentions) {
        const e = mentionEdge(m, a.outlet ?? '', hstDate(a.published))
        if (await insertEdge(db, a.id, e)) { out.inserted++; continue }
        if (!m.entityId && !m.candidates) continue
        // Same name and role already stored: upgrade it if it was not matched.
        const r = await db.query(
          `update edge set from_id = $3, match_status = $4, match_confidence = null, attributes = $5
            where document_id = $1 and type = 'mentioned_in' and coalesce(from_name_raw, '') = $2 and coalesce(role, '') = $6
              and match_status <> 'matched'
              and (from_id is distinct from $3 or match_status <> $4 or attributes -> 'candidates' is distinct from $5::jsonb -> 'candidates')`,
          [a.id, m.surface, m.entityId, m.entityId ? 'matched' : 'review', JSON.stringify(e.attributes ?? {}), m.role])
        out.updated += r.rowCount
      }
    } catch (err) {
      out.errors++
      log(`retag ${a.id}: ${(err as Error).message}`)
    }
    out.articles++
    after = a.id
  }
  out.done = out.articles === rows.length && rows.length < (opts.limit ?? 200)
  await db.query(
    `insert into import_cursor (source, cursor_offset, status, last_run_at, metadata) values ($1, 0, $2, now(), $3)
     on conflict (source) do update set status = excluded.status, last_run_at = now(), metadata = coalesce(import_cursor.metadata, '{}'::jsonb) || excluded.metadata`,
    [RETAG_SOURCE, out.done ? 'complete' : 'running', JSON.stringify({ version: TAGGER_VERSION, after })])
  return out
}

/** True when stored articles were tagged by an older tagger and the walk has not finished. */
export async function retagPending(db: Db): Promise<boolean> {
  const c = await db.one<{ status: string | null; metadata: { version?: number } | null }>(`select status, metadata from import_cursor where source = $1`, [RETAG_SOURCE])
  return c?.metadata?.version !== TAGGER_VERSION || c?.status !== 'complete'
}
