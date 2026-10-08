import type { Db } from '../types'

export interface NewsTag { id: string; kind: string; name: string; slug: string | null; role: string | null }

export interface NewsArticle {
  id: string
  url: string | null
  title: string | null
  doc_date: string | null
  published: string | null
  outlet: string | null
  outlet_name: string | null
  author: string | null
  description: string | null
  summary: string | null
  summary_author: string | null
  tags: NewsTag[]
}

export interface ListNewsOptions {
  outlet?: string
  /** Only articles tagged with this entity. */
  entityId?: string
  limit?: number
  offset?: number
}

/**
 * Aggregated news articles (source 'news'), newest first, with their latest published summary and
 * matched entity tags (mentioned_in edges with an entity; review/unmatched mentions are left out).
 */
export async function listNews(db: Db, opts: ListNewsOptions = {}): Promise<{ rows: NewsArticle[]; total: number }> {
  const params: unknown[] = []
  const where = [`d.source = 'news'`, `d.doc_type = 'article'`]
  if (opts.outlet) { params.push(opts.outlet); where.push(`d.raw ->> 'outlet' = $${params.length}`) }
  if (opts.entityId) {
    params.push(opts.entityId)
    where.push(`exists (select 1 from edge t where t.document_id = d.id and t.type = 'mentioned_in' and t.from_id = $${params.length})`)
  }
  const total = await db.one<{ n: string }>(`select count(*)::text n from document d where ${where.join(' and ')}`, params)
  params.push(Math.min(opts.limit ?? 50, 200), opts.offset ?? 0)
  const rows = await db.many<NewsArticle>(
    `select d.id, d.url, d.title, d.doc_date::text doc_date, d.raw ->> 'published' published, d.raw ->> 'outlet' outlet,
            d.raw ->> 'outlet_name' outlet_name, d.raw ->> 'author' author, d.raw ->> 'description' description,
            s.body summary, s.author summary_author,
            coalesce((select json_agg(json_build_object('id', x.id, 'kind', x.kind, 'name', x.name, 'slug', x.slug, 'role', x.role) order by x.subject desc, x.name)
                        from (select distinct on (en.id) en.id, en.kind, en.name, en.attributes ->> 'slug' slug, t.role, (t.role = 'subject') subject
                                from edge t join entity en on en.id = t.from_id
                               where t.document_id = d.id and t.type = 'mentioned_in' and t.match_status = 'matched'
                               order by en.id, (t.role = 'subject') desc) x), '[]'::json) tags
       from document d
       left join lateral (select body, author from summary where document_id = d.id and status = 'published' order by created_at desc limit 1) s on true
      where ${where.join(' and ')}
      order by d.doc_date desc nulls last, d.raw ->> 'published' desc nulls last, d.fetched_at desc
      limit $${params.length - 1} offset $${params.length}`, params)
  return { rows: rows.map(r => ({ ...r, tags: typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags })), total: Number(total?.n ?? 0) }
}

/** Outlets with at least one article, for the filter list. */
export async function newsOutletCounts(db: Db): Promise<Array<{ outlet: string; outlet_name: string; n: number }>> {
  const rows = await db.many<{ outlet: string; outlet_name: string; n: string }>(
    `select raw ->> 'outlet' outlet, max(raw ->> 'outlet_name') outlet_name, count(*)::text n
       from document where source = 'news' and doc_type = 'article' group by 1 order by 2`)
  return rows.map(r => ({ ...r, n: Number(r.n) }))
}
