/**
 * News — Hawaiʻi journalism outlets via their public RSS/Atom feeds (lib/news/outlets.ts).
 *
 * One record per outlet feed: each batch fetches `batchSize` feeds starting at `offset`, so the cursor
 * counts feeds, not articles. Every feed item becomes one `article` document (source 'news',
 * source_record_id '<outlet>:<guid>'); a re-run of an unchanged feed inserts nothing. Articles are
 * tagged with existing entities (lib/news/tagger.ts) as `mentioned_in` edges, role 'subject' when the
 * entity is in the headline and 'mentioned' otherwise. This importer never creates entities, and never
 * requests article pages: the feed is the only thing fetched.
 *
 * Summaries are written separately by lib/news/summarize.ts (cron /api/cron/news, workers/summarize-news.ts).
 *
 * Each feed's outcome (items read or the error) is merged into import_cursor.metadata.feeds[<outlet>], so a
 * failing outlet can be identified from the database.
 *
 * Params: --outlet=<key>[,<key>]  restrict to outlets.  --feed-url=<url> --outlet=<key>  read one feed URL.
 */
import type { Db } from '@/lib/db/types'
import { fetchText } from '../http'
import { processRecord, emptyResult, type BatchResult, type EdgeInput } from '../pipeline'
import type { ImportOptions, SourcePage } from '../types'
import { activeOutlets, getOutlet } from '@/lib/news/outlets'
import { parseFeed, type FeedItem } from '@/lib/news/rss'
import { tagArticle, type Mention } from '@/lib/news/tagger'

export const SOURCE_KEY = 'news'

/** One fetched feed. Tests supply these through `pageSource`. */
export interface FeedRecord { outlet: string; feedUrl: string; xml: string }

export interface ArticleRaw {
  outlet: string
  outlet_name: string
  feed_url: string
  guid: string
  link: string | null
  title: string
  author: string | null
  published: string | null
  description: string | null
  categories: string[]
}

export interface FeedStatus { feed_url: string; at: string; items: number; error: string | null }

async function recordFeedStatus(db: Db, status: Record<string, FeedStatus>) {
  if (!Object.keys(status).length) return
  await db.query(
    `update import_cursor set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('feeds', coalesce(metadata->'feeds', '{}'::jsonb) || $1::jsonb)
      where source = $2`, [JSON.stringify(status), SOURCE_KEY])
}

/**
 * One tag as a `mentioned_in` edge. An ambiguous name (several candidates) goes to review; a person or
 * organization identified only from context (not in the database) is stored `unmatched` with its kind
 * guess and cue, so staff can add or link it.
 */
export function mentionEdge(m: Mention, outlet: string, date: string | null): EdgeInput {
  return {
    type: 'mentioned_in',
    from: m.entityId
      ? { entityId: m.entityId, rawName: m.surface }
      : { entityId: null, rawName: m.surface, status: m.candidates ? 'review' : 'unmatched', confidence: null, created: false },
    to: null,
    role: m.role,
    start_date: date,
    attributes: {
      mention_type: 'news', matched_on: m.matchedOn, outlet,
      ...(m.candidates ? { candidates: m.candidates } : {}),
      ...(m.matchedOn === 'extracted' ? { kind_guess: m.kind, cue: m.cue } : {}),
    },
  }
}

export function articleBody(item: Pick<FeedItem, 'description' | 'content'>): string | null {
  return item.content ?? item.description ?? null
}

/** Hawaiʻi calendar date (UTC−10, no DST) for a publication timestamp. */
export function hstDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(new Date(iso).getTime() - 10 * 3600_000)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

export async function importBatch(db: Db, offset: number, batchSize: number, opts: ImportOptions = {}): Promise<BatchResult> {
  const log = opts.log ?? (() => {})
  const params = opts.params ?? {}
  const result = emptyResult(offset)

  const feedStatus: Record<string, FeedStatus> = {}
  const at = new Date().toISOString()
  let page: SourcePage<FeedRecord>
  if (opts.pageSource) {
    page = (await opts.pageSource(offset, batchSize, params)) as SourcePage<FeedRecord>
  } else {
    const feeds = params['feed-url'] && params.outlet
      ? [{ outlet: params.outlet, feedUrl: params['feed-url'] }]
      : activeOutlets(params.outlet).flatMap(o => o.feeds.map(feedUrl => ({ outlet: o.key, feedUrl })))
    const slice = feeds.slice(offset, offset + batchSize)
    const records: FeedRecord[] = []
    for (const f of slice) {
      try { records.push({ ...f, xml: await fetchText(f.feedUrl, { noCache: true, timeoutMs: 20_000 }) }) } catch (e) {
        result.errors++
        feedStatus[f.outlet] = { feed_url: f.feedUrl, at, items: 0, error: (e as Error).message.slice(0, 300) }
        log(`${f.outlet} ${f.feedUrl}: ${(e as Error).message}`)
      }
    }
    // Failed feeds still advance the cursor; they are retried on the next scheduled run.
    page = { records, total: feeds.length, done: offset + slice.length >= feeds.length }
    result.nextOffset = offset + slice.length
  }

  for (const feed of page.records) {
    let items: FeedItem[]
    try { items = parseFeed(feed.xml) } catch (e) {
      result.errors++
      feedStatus[feed.outlet] = { feed_url: feed.feedUrl, at, items: 0, error: `parse failed: ${(e as Error).message}`.slice(0, 300) }
      log(`${feed.outlet}: parse failed: ${(e as Error).message}`)
      continue
    }
    feedStatus[feed.outlet] = { feed_url: feed.feedUrl, at, items: items.length, error: items.length ? null : `no items (${feed.xml.slice(0, 120).replace(/\s+/g, ' ')})` }
    const outletName = getOutlet(feed.outlet)?.name ?? feed.outlet
    for (const item of items) {
      const raw: ArticleRaw = {
        outlet: feed.outlet, outlet_name: outletName, feed_url: feed.feedUrl, guid: item.guid, link: item.link,
        title: item.title, author: item.author, published: item.published, description: item.description, categories: item.categories,
      }
      const body = articleBody(item)
      try {
        await processRecord(db, {
          document: {
            source: SOURCE_KEY, source_record_id: `${feed.outlet}:${item.guid}`.slice(0, 500), doc_type: 'article',
            url: item.link, title: item.title, doc_date: hstDate(item.published), raw: { ...raw }, body_text: body,
          },
          edges: async ({ db: d }) => {
            const mentions = await tagArticle(d, { title: item.title, body, published: item.published })
            return mentions.map(m => mentionEdge(m, feed.outlet, hstDate(item.published)))
          },
        }, result)
      } catch (e) { result.errors++; log(`${feed.outlet} ${item.guid}: ${(e as Error).message}`) }
    }
  }
  await recordFeedStatus(db, feedStatus)
  if (opts.pageSource) result.nextOffset = offset + page.records.length
  result.done = page.done ?? page.records.length < batchSize
  return result
}
