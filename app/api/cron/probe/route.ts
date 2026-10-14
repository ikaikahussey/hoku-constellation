/**
 * GET|POST /api/cron/probe[?source=a,b][&all=1]   (Bearer CRON_SECRET) — hourly in vercel.json.
 *
 * Checks importer and news-feed URLs from production (lib/import/probe.ts) and stores each response
 * summary in import_cursor.metadata.probe, so broken sources can be diagnosed with a SQL query.
 * Default: the sources with repair candidates; `all=1` probes every live source's registry URLs too.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { getServiceDb } from '@/lib/db/service'
import { authenticateCron } from '@/app/api/analytics/_lib/auth'
import { runProbe, DEFAULT_PROBE_SOURCES } from '@/lib/import/probe'

export const maxDuration = 300
export const dynamic = 'force-dynamic'

async function handle(request: NextRequest) {
  const unauth = authenticateCron(request)
  if (unauth) return unauth
  const started = Date.now()
  const sp = request.nextUrl.searchParams
  const only = sp.get('all') === '1' ? undefined : (sp.get('source')?.split(',').filter(Boolean) ?? DEFAULT_PROBE_SOURCES)
  const db = await getServiceDb()
  const result = await runProbe(db, { only, deadlineMs: started + 270_000 })
  return NextResponse.json({ ok: true, ...result, durationMs: Date.now() - started })
}

export const GET = handle
export const POST = handle
