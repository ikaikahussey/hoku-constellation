/**
 * News stories: articles from different outlets about the same event, grouped so readers see one
 * headline, one summary, and every outlet's version.
 *
 * Grouping (pure, `clusterArticles`): each article is a TF-IDF vector of its headline (weighted double)
 * and the start of its text, after normalize() and stop-word removal. Articles are taken in publication
 * order; an article joins the story it is most similar to when
 *   - that story had an article within STORY_WINDOW_H hours,
 *   - its best cosine similarity to a member, plus a bonus for shared database tags, reaches JOIN_AT, and
 *   - its average similarity to the members reaches MEAN_AT (so a chain of loosely related stories
 *     does not snowball into one).
 * Identical headlines (syndicated copies) always join.
 *
 * Storage (`rebuildStories`): ax_news_story + ax_news_story_article (migration 005), recomputed for the
 * articles of the last REBUILD_DAYS days plus any article not yet in a story. A story is keyed by its
 * earliest article, so its id, and a summary already written for it, survive rebuilds; the summary is
 * redone (`summarizeStories`) only when the set of articles changes.
 *
 * Summaries follow the news rules (lib/news/summarize.ts): the model sees only stored article text, and
 * every sentence cites an article. Without a model, or when its output fails validation, the story
 * shows its lead article's own summary instead.
 */
import { createHash } from 'node:crypto'
import type { Db } from '@/lib/db/types'
import { normalize } from '@/lib/entity-match'
import { generateCitedNarrative, getNarrativeModel, type NarrativeModel } from '@/lib/ai/claude'
import { splitSentences, type Fact } from '@/lib/ai/citations'

export const STORY_WINDOW_H = 72
export const JOIN_AT = 0.42
export const MEAN_AT = 0.25
export const TAG_BONUS = 0.2
export const REBUILD_DAYS = 30
const BODY_TOKENS = 80
const LEAD_AUTHOR = 'system:lead_article'
const MAX_FACT_ARTICLES = 8
const SENTENCES_PER_ARTICLE = 4
const STORY_SENTENCES = 3

const STOP = new Set(('a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my no nor not now of off on once only or other our ours out over own same she should so some such than that the their theirs them then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours ' +
  'said says say new news one two three year years week day monday tuesday wednesday thursday friday saturday sunday ' +
  'january february march april may june july august september october november december hawaii hawaiian honolulu').split(' '))

export interface StoryArticle {
  id: string
  title: string
  text: string | null
  outlet: string
  /** Epoch ms of publication (or of the document date). */
  at: number
  /** Matched entity ids tagged on the article. */
  tags: string[]
}

export interface StoryGroup {
  key: string
  members: Array<{ id: string; similarity: number | null }>
  /** Member whose headline represents the story (most similar to the others; earliest on ties). */
  leadId: string
}

export function tokens(text: string): string[] {
  return normalize(text).split(' ').filter(t => t.length >= 3 && !STOP.has(t) && !/^\d{1,2}$/.test(t))
}

type Vec = Map<string, number>

function vectors(articles: StoryArticle[]): Vec[] {
  const tfs = articles.map(a => {
    const tf = new Map<string, number>()
    for (const t of tokens(a.title)) tf.set(t, (tf.get(t) ?? 0) + 2)
    for (const t of tokens(a.text ?? '').slice(0, BODY_TOKENS)) tf.set(t, (tf.get(t) ?? 0) + 1)
    return tf
  })
  const df = new Map<string, number>()
  for (const tf of tfs) for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1)
  const n = articles.length
  return tfs.map(tf => {
    const v: Vec = new Map()
    let norm = 0
    for (const [t, f] of tf) {
      const w = (1 + Math.log(f)) * (Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1)
      v.set(t, w)
      norm += w * w
    }
    norm = Math.sqrt(norm) || 1
    for (const [t, w] of v) v.set(t, w / norm)
    return v
  })
}

function cosine(a: Vec, b: Vec): number {
  const [small, large] = a.size < b.size ? [a, b] : [b, a]
  let s = 0
  for (const [t, w] of small) { const x = large.get(t); if (x) s += w * x }
  return s
}

function jaccard(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  const sa = new Set(a)
  let inter = 0
  for (const x of new Set(b)) if (sa.has(x)) inter++
  return inter / (sa.size + new Set(b).size - inter)
}

/** Group articles into stories. Deterministic for a given input set. */
export function clusterArticles(articles: StoryArticle[]): StoryGroup[] {
  const sorted = [...articles].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
  const vecs = vectors(sorted)
  const titleKey = sorted.map(a => normalize(a.title))
  const sim = (i: number, j: number) => titleKey[i] && titleKey[i] === titleKey[j] ? 1 : Math.min(1, cosine(vecs[i], vecs[j]) + TAG_BONUS * jaccard(sorted[i].tags, sorted[j].tags))
  const groups: Array<{ idx: number[]; last: number; joinSim: Map<number, number> }> = []
  const windowMs = STORY_WINDOW_H * 3600_000
  for (let i = 0; i < sorted.length; i++) {
    let best: { g: (typeof groups)[number]; max: number } | null = null
    for (const g of groups) {
      if (sorted[i].at - g.last > windowMs) continue
      const sims = g.idx.map(j => sim(i, j))
      const max = Math.max(...sims)
      const mean = sims.reduce((x, y) => x + y, 0) / sims.length
      if (max >= JOIN_AT && mean >= MEAN_AT && (!best || max > best.max)) best = { g, max }
    }
    if (best) {
      best.g.idx.push(i)
      best.g.last = Math.max(best.g.last, sorted[i].at)
      best.g.joinSim.set(i, best.max)
    } else {
      groups.push({ idx: [i], last: sorted[i].at, joinSim: new Map() })
    }
  }
  return groups.map(g => {
    let lead = g.idx[0], leadScore = -1
    for (const i of g.idx) {
      const score = g.idx.reduce((s, j) => s + (i === j ? 0 : sim(i, j)), 0)
      if (score > leadScore + 1e-9) { lead = i; leadScore = score }
    }
    return {
      key: sorted[g.idx[0]].id,
      members: g.idx.map(i => ({ id: sorted[i].id, similarity: g.joinSim.get(i) ?? null })),
      leadId: sorted[lead].id,
    }
  })
}

export const membersHash = (ids: string[]) => createHash('sha256').update([...ids].sort().join(',')).digest('hex').slice(0, 32)

interface ArticleRow { id: string; title: string | null; text: string | null; outlet: string | null; at: string; tags: string[] | null }

/** Recompute stories for recent and not-yet-grouped articles. */
export async function rebuildStories(db: Db, opts: { days?: number } = {}): Promise<{ articles: number; stories: number; multi: number }> {
  const days = opts.days ?? REBUILD_DAYS
  const rows = await db.many<ArticleRow>(
    `select d.id, d.title, coalesce(d.raw ->> 'description', left(d.body_text, 2000)) as text, d.raw ->> 'outlet' as outlet,
            coalesce(d.raw ->> 'published', d.doc_date::text, d.fetched_at::text) as at,
            (select array_agg(distinct e.from_id::text) from edge e
              where e.document_id = d.id and e.type = 'mentioned_in' and e.match_status = 'matched' and e.from_id is not null) as tags
       from document d
      where d.source = 'news' and d.doc_type = 'article'
        and (coalesce(d.doc_date, d.fetched_at::date) >= current_date - $1::int
             or not exists (select 1 from ax_news_story_article m where m.document_id = d.id))`, [days])
  const articles: StoryArticle[] = rows.map(r => ({
    id: r.id, title: r.title ?? '', text: r.text, outlet: r.outlet ?? '', at: new Date(r.at).getTime() || 0, tags: r.tags ?? [],
  }))
  const groups = clusterArticles(articles)
  const byId = new Map(articles.map(a => [a.id, a]))
  await db.transaction(async tx => {
    if (articles.length) await tx.query(`delete from ax_news_story_article where document_id = any($1::uuid[])`, [articles.map(a => a.id)])
    for (const g of groups) {
      const members = g.members.map(m => byId.get(m.id)!)
      const times = members.map(m => m.at).filter(t => t > 0)
      const story = await tx.one<{ id: string }>(
        `insert into ax_news_story (story_key, headline, headline_document_id, members_hash, article_count, outlet_count, first_published, last_published, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now())
         on conflict (story_key) do update set headline = excluded.headline, headline_document_id = excluded.headline_document_id,
           members_hash = excluded.members_hash, article_count = excluded.article_count, outlet_count = excluded.outlet_count,
           first_published = excluded.first_published, last_published = excluded.last_published, updated_at = now()
         returning id`,
        [g.key, byId.get(g.leadId)!.title || 'Untitled', g.leadId, membersHash(members.map(m => m.id)), members.length,
          new Set(members.map(m => m.outlet)).size,
          times.length ? new Date(Math.min(...times)).toISOString() : null, times.length ? new Date(Math.max(...times)).toISOString() : null])
      for (const m of g.members) {
        await tx.query(`insert into ax_news_story_article (story_id, document_id, similarity) values ($1, $2, $3)`, [story!.id, m.id, m.similarity])
      }
    }
    await tx.query(`delete from ax_news_story s where not exists (select 1 from ax_news_story_article m where m.story_id = s.id)`)
  })
  return { articles: articles.length, stories: groups.length, multi: groups.filter(g => g.members.length > 1).length }
}

interface PendingStory { id: string; members_hash: string; headline_document_id: string | null }
interface MemberText { id: string; title: string | null; body_text: string | null; description: string | null; outlet_name: string | null; published: string | null; lead_summary: string | null }

/** Story facts: each outlet's headline and its first sentences, cited to that outlet's article. */
export function storyFacts(members: MemberText[]): Fact[] {
  const facts: Fact[] = []
  const seenOutlets = new Set<string>()
  // One article per outlet first, then the rest, up to MAX_FACT_ARTICLES.
  const ordered = [...members.filter(m => !seenOutlets.has(m.outlet_name ?? '') && seenOutlets.add(m.outlet_name ?? '')), ...members]
  const used = new Set<string>()
  for (const m of ordered) {
    if (used.has(m.id) || used.size >= MAX_FACT_ARTICLES) continue
    used.add(m.id)
    const date = m.published?.slice(0, 10) ?? null
    const outlet = m.outlet_name ?? 'An outlet'
    if (m.title) facts.push({ documentId: m.id, text: `${outlet} headline: ${m.title}`, date, kind: 'headline' })
    for (const s of splitSentences(m.body_text ?? m.description ?? '').slice(0, SENTENCES_PER_ARTICLE)) facts.push({ documentId: m.id, text: `${outlet}: ${s}`, date, kind: 'article' })
  }
  return facts
}

/** Write summaries for multi-article stories whose articles changed since their last summary. */
export async function summarizeStories(db: Db, opts: { limit?: number; deadlineMs?: number; model?: NarrativeModel | null; log?: (m: string) => void } = {}): Promise<{ considered: number; model: number; fallback: number; errors: number }> {
  const log = opts.log ?? (() => {})
  const model = opts.model === undefined ? getNarrativeModel() : opts.model
  const pending = await db.many<PendingStory>(
    `select id, members_hash, headline_document_id from ax_news_story
      where article_count > 1 and (summary is null or summary_members_hash is distinct from members_hash
                                   or (summary_author = $2 and $3::boolean))
      order by last_published desc nulls last limit $1`, [opts.limit ?? 100, LEAD_AUTHOR, !!model])
  const out = { considered: 0, model: 0, fallback: 0, errors: 0 }
  for (const p of pending) {
    if (opts.deadlineMs && Date.now() >= opts.deadlineMs) break
    out.considered++
    try {
      const members = await db.many<MemberText>(
        `select d.id, d.title, d.body_text, d.raw ->> 'description' description, d.raw ->> 'outlet_name' outlet_name, d.raw ->> 'published' published,
                (select body from summary s where s.document_id = d.id and s.status = 'published' order by created_at desc limit 1) lead_summary
           from ax_news_story_article m join document d on d.id = m.document_id
          where m.story_id = $1 order by d.raw ->> 'published' nulls last, d.id`, [p.id])
      let body: string | null = null, author = LEAD_AUTHOR, cites: string[] = []
      const facts = storyFacts(members)
      if (model && facts.length > 1) {
        const outlets = [...new Set(members.map(m => m.outlet_name).filter(Boolean))].join(', ')
        const r = await generateCitedNarrative({
          task: 'Summarize this news story for a research briefing on Hawaiʻi government and influence, drawing on every outlet\'s report: who did what, and what happens next if the reports say.',
          facts,
          maxSentences: STORY_SENTENCES,
          rules: [
            `The facts are sentences from reports of the same event by these outlets: ${outlets}. Attribute contested claims, allegations and figures that differ between outlets to the outlet or to the person quoted; do not state them as established fact.`,
            'Use names exactly as the reports give them. Do not add titles, party labels, or context the reports do not contain.',
          ],
        }, model)
        if (r.source === 'model' && r.sentences.length) {
          body = r.sentences.map(s => s.text).join(' ')
          author = `model:${r.model}`
          cites = [...new Set(r.sentences.flatMap(s => s.documentIds))]
        }
      }
      if (!body) {
        const lead = members.find(m => m.id === p.headline_document_id) ?? members[0]
        body = lead?.lead_summary ?? splitSentences(lead?.description ?? lead?.body_text ?? '').slice(0, 2).join(' ') ?? null
        cites = lead ? [lead.id] : []
      }
      await db.query(
        `update ax_news_story set summary = $2, summary_author = $3, summary_cites = $4, summary_members_hash = $5 where id = $1`,
        [p.id, body || null, author, cites, p.members_hash])
      if (author === LEAD_AUTHOR) out.fallback++; else out.model++
    } catch (e) {
      out.errors++
      log(`story ${p.id}: ${(e as Error).message}`)
    }
  }
  return out
}
