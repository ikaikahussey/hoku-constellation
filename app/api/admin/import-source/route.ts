/**
 * POST /api/admin/import-source  { source, offset?, batchSize?, dry?, params? }
 * Runs one batch (≤ maxDuration) of a live importer under the staff session. The admin UI loops on
 * `nextOffset` until `done`. Writes go through the service connection; the cursor advances per batch.
 *
 * GET /api/admin/import-source?source=<key>  → cursor + document/edge counts for the source.
 */
import { NextRequest, NextResponse } from 'next/server'
import { authenticateStaff } from '@/app/api/analytics/_lib/auth'
import { getSource, SOURCE_REGISTRY } from '@/lib/import/source-registry'
import { loadImporter } from '@/lib/import/sources'
import { runImporter } from '@/lib/import/run'
import { getCursor } from '@/lib/import/pipeline'
import { countDocumentsBySource } from '@/lib/db/queries'

export const maxDuration = 55
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const { error, db } = await authenticateStaff()
  if (error) return error
  const source = request.nextUrl.searchParams.get('source')
  if (!source) {
    return NextResponse.json({ sources: SOURCE_REGISTRY.map(s => ({ key: s.key, name: s.name, status: s.status, tier: s.tier, cadence: s.cadence })) })
  }
  const def = getSource(source)
  const cursor = await getCursor(db, source)
  const counts = (await countDocumentsBySource(db)).filter(c => c.source === source)
  return NextResponse.json({ source: def, cursor, counts })
}

export async function POST(request: NextRequest) {
  const { error, db } = await authenticateStaff()
  if (error) return error
  let body: { source?: string; offset?: number; batchSize?: number; dry?: boolean; params?: Record<string, string> }
  try { body = await request.json() } catch { return NextResponse.json({ error: 'JSON body required' }, { status: 400 }) }
  if (!body.source) return NextResponse.json({ error: 'source is required' }, { status: 400 })
  let def
  try { def = getSource(body.source) } catch { return NextResponse.json({ error: `Unknown source ${body.source}` }, { status: 404 }) }
  if (def.status === 'blocked' || def.status === 'retired') return NextResponse.json({ error: `Source ${def.key} is ${def.status}: ${def.notes ?? ''}` }, { status: 409 })
  if (def.status === 'manual') return NextResponse.json({ error: `Source ${def.key} is manual — upload its file via /api/import` }, { status: 409 })
  let mod
  try { mod = await loadImporter(def.key) } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 501 }) }
  const logs: string[] = []
  try {
    const summary = await runImporter(db, def.key, mod.importBatch, {
      batchSize: Math.min(Math.max(body.batchSize ?? 200, 1), 1000), maxBatches: 1, dry: !!body.dry,
      params: body.params, offset: typeof body.offset === 'number' ? body.offset : undefined, resume: body.offset == null,
      log: (m) => { if (logs.length < 50) logs.push(m) },
    })
    return NextResponse.json({ ...summary, logs })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message, logs }, { status: 500 })
  }
}
