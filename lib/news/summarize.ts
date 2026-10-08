/**
 * Summaries for aggregated news articles. Each summary is a `summary` row with document_id set,
 * status 'published', tier 'free', and cites = [article document id].
 *
 * The model sees only the article text stored in `document` (feed title, excerpt, and body) and must
 * cite it on every sentence (lib/ai/claude.ts → lib/ai/citations.ts). Without ANTHROPIC_API_KEY, or
 * when the model's output fails validation twice, the summary falls back to the first sentences of the
 * publisher's own excerpt (author 'system:feed_excerpt'); `retryFallbacks` upgrades those later.
 *
 * Re-summarizes an article when its document was updated in place after the summary was written.
 * Staff-written summaries (author 'staff:…') are never replaced.
 */
import type { Db } from '@/lib/db/types'
import { generateCitedNarrative, getNarrativeModel, type NarrativeModel } from '@/lib/ai/claude'
import { splitSentences, type Fact } from '@/lib/ai/citations'
import { insertSummary } from '@/lib/db/queries/summaries'

export const FALLBACK_AUTHOR = 'system:feed_excerpt'
const MAX_FACTS = 40
const MAX_FACT_CHARS = 8000
const SUMMARY_SENTENCES = 3

export interface SummarizeOptions {
  limit?: number
  /** Stop starting new articles after this epoch-ms deadline. */
  deadlineMs?: number
  /** Also redo summaries that fell back to the feed excerpt (only when a model is configured). */
  retryFallbacks?: boolean
  /** Inject a model (tests). `null` forces the feed-excerpt fallback. */
  model?: NarrativeModel | null
  log?: (msg: string) => void
}

export interface SummarizeResult { considered: number; model: number; fallback: number; errors: number }

interface PendingArticle { id: string; title: string | null; body_text: string | null; raw: { outlet_name?: string; description?: string | null; published?: string | null } }

export async function pendingArticles(db: Db, limit: number, retryFallbacks: boolean): Promise<PendingArticle[]> {
  return db.many<PendingArticle>(
    `select d.id, d.title, d.body_text, d.raw from document d
      where d.source = 'news' and d.doc_type = 'article'
        and not exists (
          select 1 from summary s where s.document_id = d.id
             and (s.author like 'staff:%' or (s.created_at >= d.fetched_at and not ($2 and s.author = $3))))
      order by d.doc_date desc nulls last, d.fetched_at desc
      limit $1`, [limit, retryFallbacks, FALLBACK_AUTHOR])
}

/** Article text as citable facts: the headline, then body sentences in order. */
export function articleFacts(a: PendingArticle): Fact[] {
  const date = a.raw.published?.slice(0, 10) ?? null
  const facts: Fact[] = []
  if (a.title) facts.push({ documentId: a.id, text: `Headline: ${a.title}`, date, kind: 'headline' })
  let chars = 0
  for (const s of splitSentences(a.body_text ?? a.raw.description ?? '')) {
    if (facts.length >= MAX_FACTS || chars + s.length > MAX_FACT_CHARS) break
    chars += s.length
    facts.push({ documentId: a.id, text: s, date, kind: 'article' })
  }
  return facts
}

/** First sentences of the publisher's excerpt (or body), used when no model output is accepted. */
export function excerptSummary(a: PendingArticle): string | null {
  const sentences = splitSentences(a.raw.description ?? a.body_text ?? '').slice(0, 2)
  const text = sentences.join(' ').trim()
  return text || a.title || null
}

export async function summarizeArticle(db: Db, a: PendingArticle, model: NarrativeModel | null): Promise<'model' | 'fallback' | null> {
  const outlet = a.raw.outlet_name ?? 'the outlet'
  const facts = articleFacts(a)
  let body: string | null = null
  let author = FALLBACK_AUTHOR
  if (model && facts.length > 1) {
    const r = await generateCitedNarrative({
      task: `Summarize this ${outlet} news article for a research briefing on Hawaiʻi government and influence: who did what, and what happens next if the article says.`,
      facts,
      maxSentences: SUMMARY_SENTENCES,
      rules: [
        `The facts are sentences from one news article published by ${outlet}. Attribute contested claims and allegations to ${outlet} or to the person the article quotes; do not state them as established fact.`,
        'Use names exactly as the article gives them. Do not add titles, party labels, or context the article does not contain.',
      ],
    }, model)
    if (r.source === 'model' && r.sentences.length) {
      body = r.sentences.map(s => s.text).join(' ')
      author = `model:${r.model}`
    }
  }
  body ??= excerptSummary(a)
  if (!body) return null
  await db.transaction(async tx => {
    await tx.query(`delete from summary where document_id = $1 and author not like 'staff:%'`, [a.id])
    await insertSummary(tx, { document_id: a.id, body, cites: [a.id], author, status: 'published', tier: 'free' })
  })
  return author === FALLBACK_AUTHOR ? 'fallback' : 'model'
}

export async function summarizePendingArticles(db: Db, opts: SummarizeOptions = {}): Promise<SummarizeResult> {
  const log = opts.log ?? (() => {})
  const model = opts.model === undefined ? getNarrativeModel() : opts.model
  const pending = await pendingArticles(db, opts.limit ?? 50, !!opts.retryFallbacks && !!model)
  const out: SummarizeResult = { considered: 0, model: 0, fallback: 0, errors: 0 }
  for (const a of pending) {
    if (opts.deadlineMs && Date.now() >= opts.deadlineMs) break
    out.considered++
    try {
      const r = await summarizeArticle(db, a, model)
      if (r === 'model') out.model++
      else if (r === 'fallback') out.fallback++
    } catch (e) {
      out.errors++
      log(`summary ${a.id}: ${(e as Error).message}`)
    }
  }
  return out
}
