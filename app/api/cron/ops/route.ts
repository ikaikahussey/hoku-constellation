/**
 * GET|POST /api/cron/ops   (Bearer CRON_SECRET) — hourly in vercel.json.
 *   - Tier 1 freshness check (owner alert at 2x target)
 *   - Mondays 07:xx HST: weekly report auto-drafts (never sent) and the design-partner usage email
 */
import { NextResponse, type NextRequest } from 'next/server'
import { getServiceDb } from '@/lib/db/service'
import { authenticateCron } from '@/app/api/analytics/_lib/auth'
import { checkFreshness } from '@/lib/ops/coverage'
import { sendWeeklyPartnerSummary } from '@/lib/ops/partners'
import { runWeeklyAutoDrafts } from '@/lib/reports'
import { isWeeklySlot } from '@/lib/ops/schedule'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

async function handle(request: NextRequest) {
  const unauth = authenticateCron(request)
  if (unauth) return unauth
  const db = await getServiceDb()
  const now = new Date()
  const stale = await checkFreshness(db, { now })
  const weekly = isWeeklySlot(now) || request.nextUrl.searchParams.get('weekly') === '1'
  const drafts = weekly ? await runWeeklyAutoDrafts(db, { now }) : 0
  const summary = weekly ? await sendWeeklyPartnerSummary(db) : false
  return NextResponse.json({ ok: true, stale, weekly, drafts, summary })
}

export const GET = handle
export const POST = handle
