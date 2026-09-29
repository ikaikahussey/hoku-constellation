/**
 * GET|POST /api/cron/alerts   (Bearer CRON_SECRET)
 *
 * Alert pipeline tick for the Vercel deployment (every minute in vercel.json): matcher, instant
 * delivery (deferrals, retries), and digests. The Mac mini runs the same loop in workers/alerts.ts.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { getServiceDb } from '@/lib/db/service'
import { authenticateCron } from '@/app/api/analytics/_lib/auth'
import { runAlertPipeline } from '@/lib/alerts'

export const maxDuration = 60
export const dynamic = 'force-dynamic'

async function handle(request: NextRequest) {
  const unauth = authenticateCron(request)
  if (unauth) return unauth
  const db = await getServiceDb()
  const r = await runAlertPipeline(db, { digests: true })
  return NextResponse.json({ ok: true, ...r })
}

export const GET = handle
export const POST = handle
