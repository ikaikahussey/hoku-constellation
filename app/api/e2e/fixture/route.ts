/**
 * Offline e2e only: simulates an upstream change the way an importer would record it. 404 unless test
 * auth is enabled (localhost + E2E_TEST_AUTH_SECRET, never on Vercel).
 *
 *   POST { action: 'bill_status', measure: 'SB1234', session: '2026', status: '…' }
 */
import { NextResponse, type NextRequest } from 'next/server'
import { testAuthEnabled } from '@/lib/auth'
import { getServiceDb } from '@/lib/db/service'
import { upsertDocument } from '@/lib/import/pipeline'

export async function POST(request: NextRequest) {
  if (!testAuthEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const b = await request.json() as { action?: string; measure?: string; session?: string; status?: string; date?: string }
  if (b.action !== 'bill_status' || !b.measure || !b.session || !b.status) return NextResponse.json({ error: 'unsupported fixture' }, { status: 400 })
  const db = await getServiceDb()
  const date = b.date ?? new Date().toISOString().slice(0, 10)
  const doc = await upsertDocument(db, {
    source: 'capitol_measures', source_record_id: `${b.session}:${b.measure}`, doc_type: 'measure', title: `${b.measure} (${b.session})`, doc_date: date,
    raw: { measure: b.measure, session: b.session, currentStatus: b.status, statusHistory: [{ date, chamber: 'S', text: b.status }] },
  })
  await db.query(`update entity set attributes = attributes || jsonb_build_object('current_status', $2::text) where kind = 'bill' and identifiers->>'measure' = $1`, [`${b.session}:${b.measure}`, b.status])
  return NextResponse.json({ ok: true, document_id: doc.id })
}
