/**
 * GET /api/health — uptime check target (Better Stack or equivalent). 200 when the app and database
 * respond; the body reports Tier 1 freshness so the status page can show degraded ingestion.
 */
import { NextResponse } from 'next/server'
import { getServiceDb } from '@/lib/db/service'
import { coverage } from '@/lib/ops/coverage'

export const dynamic = 'force-dynamic'

export async function GET() {
  const started = Date.now()
  try {
    const db = await getServiceDb()
    await db.one(`select 1`)
    const stale = (await coverage(db)).filter(r => r.late2x).map(r => r.key)
    return NextResponse.json({ status: stale.length ? 'degraded' : 'ok', database: 'ok', stale_tier1_sources: stale, ms: Date.now() - started }, { headers: { 'cache-control': 'no-store' } })
  } catch {
    return NextResponse.json({ status: 'down', database: 'error', ms: Date.now() - started }, { status: 503, headers: { 'cache-control': 'no-store' } })
  }
}
