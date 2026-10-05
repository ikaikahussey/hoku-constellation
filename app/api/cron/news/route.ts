/**
 * GET|POST /api/cron/news[?limit=N][&retry=1]   (Bearer CRON_SECRET) — hourly in vercel.json.
 *
 * Summarizes news articles collected by the `news` importer (which /api/cron/ingest runs on its
 * hourly cadence). Each summary cites its article; see lib/news/summarize.ts.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { getServiceDb } from '@/lib/db/service'
import { authenticateCron } from '@/app/api/analytics/_lib/auth'
import { summarizePendingArticles } from '@/lib/news/summarize'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

const BUDGET_MS = 240_000

async function handle(request: NextRequest) {
  const unauth = authenticateCron(request)
  if (unauth) return unauth
  const started = Date.now()
  const sp = request.nextUrl.searchParams
  const limit = Math.min(Math.max(Number(sp.get('limit') ?? 100) || 100, 1), 500)
  const db = await getServiceDb()
  const errors: string[] = []
  const result = await summarizePendingArticles(db, {
    limit, deadlineMs: started + BUDGET_MS, retryFallbacks: sp.get('retry') === '1',
    log: m => { if (errors.length < 20) errors.push(m) },
  })
  return NextResponse.json({ ok: true, ...result, errorsSample: errors, durationMs: Date.now() - started })
}

export const GET = handle
export const POST = handle
