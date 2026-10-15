/**
 * GET|POST /api/cron/news[?limit=N][&retry=1]   (Bearer CRON_SECRET) — hourly in vercel.json.
 *
 * After the `news` importer (run by /api/cron/ingest on its hourly cadence):
 *   1. re-tags stored articles when the tagging rules changed (lib/news/retag.ts),
 *   2. summarizes new articles (lib/news/summarize.ts),
 *   3. regroups recent articles into stories (lib/news/stories.ts), and
 *   4. summarizes stories whose articles changed.
 * Every summary cites the articles it draws on.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { getServiceDb } from '@/lib/db/service'
import { authenticateCron } from '@/app/api/analytics/_lib/auth'
import { summarizePendingArticles } from '@/lib/news/summarize'
import { retagArticles, retagPending } from '@/lib/news/retag'
import { rebuildStories, summarizeStories } from '@/lib/news/stories'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

const BUDGET_MS = 240_000
const RETAG_MS = 60_000
const ARTICLE_SUMMARY_MS = 150_000

async function handle(request: NextRequest) {
  const unauth = authenticateCron(request)
  if (unauth) return unauth
  const started = Date.now()
  const sp = request.nextUrl.searchParams
  const limit = Math.min(Math.max(Number(sp.get('limit') ?? 100) || 100, 1), 500)
  const db = await getServiceDb()
  const errors: string[] = []
  const log = (m: string) => { if (errors.length < 20) errors.push(m) }
  const retag = await retagPending(db) ? await retagArticles(db, { limit: 500, deadlineMs: started + RETAG_MS, log }) : null
  const articles = await summarizePendingArticles(db, {
    limit, deadlineMs: started + ARTICLE_SUMMARY_MS, retryFallbacks: sp.get('retry') === '1', log,
  })
  const stories = await rebuildStories(db)
  const storySummaries = await summarizeStories(db, { deadlineMs: started + BUDGET_MS, log })
  return NextResponse.json({ ok: true, retag, ...articles, stories, storySummaries, errorsSample: errors, durationMs: Date.now() - started })
}

export const GET = handle
export const POST = handle
