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

// ---------------------------------------------------------------- stories

export interface NewsStoryTag extends NewsTag { articles: number }

export interface NewsStory {
  /** ax_news_story id, or the article id for an article not yet grouped. */
  id: string
  headline: string
  summary: string | null
  summary_author: string | null
  last_published: string | null
  outlet_count: number
  articles: NewsArticle[]
  /** Matched entities across the story's articles; subjects and the most-mentioned first. */
  tags: NewsStoryTag[]
}

const ARTICLE_SELECT = `
  select d.id, d.url, d.title, d.doc_date::text doc_date, d.raw ->> 'published' published, d.raw ->> 'outlet' outlet,
         d.raw ->> 'outlet_name' outlet_name, d.raw ->> 'author' author, d.raw ->> 'description' description,
         s.body summary, s.author summary_author,
         coalesce((select json_agg(json_build_object('id', x.id, 'kind', x.kind, 'name', x.name, 'slug', x.slug, 'role', x.role) order by x.subject desc, x.name)
                     from (select distinct on (en.id) en.id, en.kind, en.name, en.attributes ->> 'slug' slug, t.role, (t.role = 'subject') subject
                             from edge t join entity en on en.id = t.from_id
                            where t.document_id = d.id and t.type = 'mentioned_in' and t.match_status = 'matched'
                            order by en.id, (t.role = 'subject') desc) x), '[]'::json) tags
    from document d
    left join lateral (select body, author from summary where document_id = d.id and status = 'published' order by created_at desc limit 1) s on true`

const parseTags = (r: NewsArticle): NewsArticle => ({ ...r, tags: typeof r.tags === 'string' ? JSON.parse(r.tags) : r.tags })

/** Union of the articles' tags: subjects first, then by number of articles, then name. */
export function storyTags(articles: NewsArticle[]): NewsStoryTag[] {
  const byId = new Map<string, NewsStoryTag>()
  for (const a of articles) for (const t of a.tags) {
    const prev = byId.get(t.id)
    if (prev) { prev.articles++; if (t.role === 'subject') prev.role = 'subject' }
    else byId.set(t.id, { ...t, articles: 1 })
  }
  return [...byId.values()].sort((a, b) => Number(b.role === 'subject') - Number(a.role === 'subject') || b.articles - a.articles || a.name.localeCompare(b.name))
}

/**
 * News grouped into stories (ax_news_story), newest first. Articles not yet grouped (imported since the
 * last rebuild) appear as one-article stories. Filters keep a story when any of its articles matches.
 */
export async function listNewsStories(db: Db, opts: ListNewsOptions = {}): Promise<{ rows: NewsStory[]; total: number }> {
  const params: unknown[] = []
  const filters: string[] = []
  if (opts.outlet) { params.push(opts.outlet); filters.push(`d.raw ->> 'outlet' = $${params.length}`) }
  if (opts.entityId) {
    params.push(opts.entityId)
    filters.push(`exists (select 1 from edge t where t.document_id = d.id and t.type = 'mentioned_in' and t.match_status = 'matched' and t.from_id = $${params.length})`)
  }
  const match = filters.length
    ? `and exists (select 1 from document d where d.id = any(u.docs) and ${filters.join(' and ')})` : ''
  const units = `
    with units as (
      select s.id::text uid, s.headline, s.summary, s.summary_author, s.last_published ts, s.outlet_count,
             array(select m.document_id from ax_news_story_article m where m.story_id = s.id) docs
        from ax_news_story s
      union all
      select d.id::text, coalesce(d.title, 'Untitled'), null, null,
             coalesce((d.raw ->> 'published')::timestamptz, d.doc_date::timestamptz, d.fetched_at), 1, array[d.id]
        from document d
       where d.source = 'news' and d.doc_type = 'article'
         and not exists (select 1 from ax_news_story_article m where m.document_id = d.id)
    )`
  const total = await db.one<{ n: string }>(`${units} select count(*)::text n from units u where cardinality(u.docs) > 0 ${match}`, params)
  params.push(Math.min(opts.limit ?? 50, 200), opts.offset ?? 0)
  const stories = await db.many<{ uid: string; headline: string; summary: string | null; summary_author: string | null; ts: string | null; outlet_count: number; docs: string[] }>(
    `${units} select uid, headline, summary, summary_author, ts::text ts, outlet_count, docs from units u
      where cardinality(u.docs) > 0 ${match}
      order by u.ts desc nulls last, u.uid limit $${params.length - 1} offset $${params.length}`, params)
  const ids = stories.flatMap(s => s.docs)
  const articles = ids.length
    ? (await db.many<NewsArticle>(`${ARTICLE_SELECT} where d.id = any($1::uuid[])`, [ids])).map(parseTags)
    : []
  const byId = new Map(articles.map(a => [a.id, a]))
  const rows = stories.map((s): NewsStory => {
    const arts = s.docs.map(id => byId.get(id)).filter((a): a is NewsArticle => !!a)
      .sort((a, b) => (a.published ?? a.doc_date ?? '').localeCompare(b.published ?? b.doc_date ?? '') || a.id.localeCompare(b.id))
    const lead = arts.find(a => a.title === s.headline) ?? arts[0]
    return {
      id: s.uid, headline: s.headline,
      summary: s.summary ?? lead?.summary ?? lead?.description ?? null,
      summary_author: s.summary ? s.summary_author : (lead?.summary_author ?? null),
      last_published: s.ts, outlet_count: Number(s.outlet_count) || new Set(arts.map(a => a.outlet)).size,
      articles: arts, tags: storyTags(arts),
    }
  })
  return { rows, total: Number(total?.n ?? 0) }
}
