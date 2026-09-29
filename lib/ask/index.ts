/**
 * Ask HOKU Insider (E5): corpus Q&A with citations.
 *
 * Retrieval: vector search over document and summary embeddings (when an embedder is configured),
 * full-text search over documents, and structured edge queries for money and relationship
 * questions about entities named in the question. The model sees only the retrieved facts; every
 * answer sentence cites a document, and the answer says so when the corpus does not support one.
 *
 * Rate limits come from entitlements (Pro 100/day per seat, Organization 300/day per seat, Reader
 * none). Only question length and result count are logged — never the text.
 */
import type { Db } from '@/lib/db/types'
import type { Entitlements } from '@/lib/entitlements'
import { generateCitedNarrative, type NarrativeModel } from '@/lib/ai/claude'
import type { Fact } from '@/lib/ai/citations'
import { embeddingsConfigured, openAiCompatibleEmbedder, type Embedder } from '@/lib/ai/embeddings'

export interface AskFilters { from?: string | null; to?: string | null; source?: string | null; entityId?: string | null }
export interface AskSource { id: string; title: string | null; source: string; doc_date: string | null; url: string | null }
export interface AskResult {
  answer: Array<{ text: string; documentIds: string[] }>
  insufficient: boolean
  sources: AskSource[]
  resultCount: number
  remaining: number
  answeredBy: 'model' | 'facts_only' | 'none'
}

export class AskError extends Error { constructor(message: string, public status = 400) { super(message) } }

const MONEY = /\b(contribut\w*|donat\w*|money|paid|pay|spen[dt]\w*|funds?|funded|gave|given|lobb\w*|contracts?|grants?|awarded|owns?|leases?|disclos\w*)\b/i
const ISO = /^\d{4}-\d{2}-\d{2}$/
const MAX_FACTS = 18

export async function questionsToday(db: Db, userId: string): Promise<number> {
  return (await db.one<{ n: number }>(`select count(*)::int n from app.ask_log where user_id = $1 and created_at > now() - interval '24 hours'`, [userId]))!.n
}

export async function ask(db: Db, args: {
  userId: string; teamId: string | null; question: string; filters?: AskFilters; entitlements: Entitlements
  model?: NarrativeModel | null; embed?: Embedder | null
}): Promise<AskResult> {
  const e = args.entitlements
  if (!e.qa && !e.is_staff) throw new AskError('Ask HOKU Insider is included in the Pro and Organization plans', 403)
  const q = args.question.replace(/\s+/g, ' ').trim()
  if (q.length < 4) throw new AskError('Ask a longer question')
  if (q.length > 1000) throw new AskError('Questions are limited to 1,000 characters')
  const limit = e.qa_daily_limit
  const used = await questionsToday(db, args.userId)
  if (!e.is_staff && used >= limit) throw new AskError(`Daily limit reached (${limit} questions per seat per 24 hours)`, 429)

  const f = args.filters ?? {}
  const from = f.from && ISO.test(f.from) ? f.from : null
  const to = f.to && ISO.test(f.to) ? f.to : null
  const source = f.source?.trim() || null
  const entityId = f.entityId && /^[0-9a-f-]{36}$/i.test(f.entityId) ? f.entityId : null
  const docFilter = `($2::date is null or d.doc_date >= $2) and ($3::date is null or d.doc_date <= $3) and ($4::text is null or d.source = $4)
    and ($5::uuid is null or exists (select 1 from edge x where x.document_id = d.id and (x.from_id = $5 or x.to_id = $5)))`

  const facts: Fact[] = []
  const seenDocs = new Set<string>()
  const addDoc = (id: string, text: string, date: string | null, kind: string) => {
    if (facts.length >= MAX_FACTS) return
    facts.push({ documentId: id, text: text.replace(/\s+/g, ' ').trim().slice(0, 700), date, kind })
    seenDocs.add(id)
  }

  // 1. Vector search (documents, then published summaries), when embeddings are available.
  const embed = args.embed === undefined ? (embeddingsConfigured() ? openAiCompatibleEmbedder() : null) : args.embed
  if (embed) {
    try {
      const [vec] = await embed([q])
      const v = `[${vec.join(',')}]`
      const docs = await db.many<{ id: string; title: string | null; body: string | null; doc_date: string | null; source: string }>(
        `select d.id, d.title, left(d.body_text, 700) body, d.doc_date::text doc_date, d.source from document d
          where d.embedding is not null and ${docFilter} order by d.embedding <=> $1::vector limit 8`, [v, from, to, source, entityId])
      for (const d of docs) addDoc(d.id, `${d.title ?? d.source}: ${d.body ?? ''}`, d.doc_date, d.source)
      const sums = await db.many<{ body: string; cites: string[]; document_id: string | null }>(
        `select s.body, s.cites, s.document_id from summary s where s.embedding is not null and s.status = 'published'
            and (s.tier = 'free' or $2::boolean) order by s.embedding <=> $1::vector limit 4`, [v, e.paid_content || e.is_staff])
      for (const s of sums) {
        const doc = s.cites[0] ?? s.document_id
        if (doc && !seenDocs.has(doc)) addDoc(doc, s.body, null, 'summary')
      }
    } catch { /* embeddings are an enhancement; full-text below still runs */ }
  }

  // 2. Full-text search.
  const fts = await db.many<{ id: string; title: string | null; snippet: string; doc_date: string | null; source: string }>(
    `select d.id, d.title, ts_headline('english', coalesce(d.body_text, d.title, ''), websearch_to_tsquery('english', $1), 'MaxWords=60, MinWords=20, StartSel=, StopSel=') snippet,
            d.doc_date::text doc_date, d.source
       from document d
      where to_tsvector('english', coalesce(d.body_text, '')) @@ websearch_to_tsquery('english', $1) and ${docFilter}
      order by ts_rank(to_tsvector('english', coalesce(d.body_text, '')), websearch_to_tsquery('english', $1)) desc, d.doc_date desc nulls last
      limit 10`, [q, from, to, source, entityId])
  for (const d of fts) if (!seenDocs.has(d.id)) addDoc(d.id, `${d.title ?? d.source}: ${d.snippet}`, d.doc_date, d.source)

  // 3. Structured edges for entities named in the question (or the entity filter).
  const entities = entityId
    ? await db.many<{ id: string; name: string }>(`select id, name from entity where id = $1`, [entityId])
    : await db.many<{ id: string; name: string }>(
      `select id, name from entity where kind in ('person','org','bill','docket') and length(name) > 3 and name <% $1
        order by word_similarity(name, $1) desc limit 4`, [q])
  if (entities.length && (MONEY.test(q) || entityId)) {
    const rows = await db.many<{ a: string; type: string; b: string; total: string | null; n: number; docs: string[]; first: string | null; last: string | null }>(
      `select coalesce(f.name, e.from_name_raw) a, e.type, coalesce(t.name, e.to_name_raw, '') b, sum(e.amount)::text total, count(*)::int n,
              (array_agg(distinct e.document_id))[1:5] docs, min(e.start_date)::text first, max(e.start_date)::text last
         from edge e left join entity f on f.id = e.from_id left join entity t on t.id = e.to_id join document d on d.id = e.document_id
        where (e.from_id = any($1::uuid[]) or e.to_id = any($1::uuid[])) and e.match_status = 'matched' and e.type <> 'mentioned_in'
          and ($2::date is null or coalesce(e.start_date, d.doc_date) >= $2) and ($3::date is null or coalesce(e.start_date, d.doc_date) <= $3)
          and ($4::text is null or d.source = $4) and ($5::boolean or not (e.type = any(app.paid_edge_types())))
        group by 1, 2, 3 order by sum(e.amount) desc nulls last, count(*) desc limit 12`,
      [entities.map(x => x.id), from, to, source, e.paid_content || e.is_staff])
    for (const r of rows) {
      const amount = r.total ? ` totaling $${Math.round(Number(r.total)).toLocaleString('en-US')}` : ''
      const span = r.first ? ` between ${r.first} and ${r.last}` : ''
      if (facts.length < MAX_FACTS + 6) facts.push({ documentId: r.docs[0], text: `${r.a} ${r.type.replace(/_/g, ' ')} ${r.b}: ${r.n} record(s)${amount}${span}`, kind: 'records' })
    }
  }

  let result: AskResult
  if (!facts.length) {
    result = { answer: [], insufficient: true, sources: [], resultCount: 0, remaining: Math.max(0, limit - used - 1), answeredBy: 'none' }
  } else {
    const n = await generateCitedNarrative({
      task: `Answer this question using only the facts: ${JSON.stringify(q)}`, facts, maxSentences: 6,
      rules: ['If the facts do not answer the question, set insufficient to true and say what the records do and do not show.', 'Do not use outside knowledge.'],
    }, args.model === undefined ? undefined : args.model)
    const ids = [...new Set(n.sentences.flatMap(s => s.documentIds).concat(facts.map(x => x.documentId)))]
    const sources = await db.many<AskSource>(`select id, title, source, doc_date::text doc_date, url from document where id = any($1::uuid[])`, [ids])
    result = {
      answer: n.source === 'model' ? n.sentences : n.sentences.slice(0, 6), insufficient: n.insufficient, sources, resultCount: facts.length,
      remaining: Math.max(0, limit - used - 1), answeredBy: n.source,
    }
  }
  await db.query(`insert into app.ask_log(user_id, team_id, question_length, result_count) values ($1, $2, $3, $4)`, [args.userId, args.teamId, q.length, result.resultCount])
  if (args.teamId) await db.query(`insert into app.usage_event(team_id, user_id, kind) values ($1, $2, 'qa.asked')`, [args.teamId, args.userId])
  return result
}
