import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { getServiceDb } from '@/lib/db/service'
import type { Db } from '@/lib/db/types'

/** REST API access requires the `api` entitlement (Organization plan, legacy Professional/Institutional, or staff). */
export async function authenticateApiRequest(): Promise<{ error: NextResponse | null; userId: string | null; tier: string | null; db: Db }> {
  const db = await getServiceDb()
  const user = await getCurrentUser()
  if (!user) return { error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }), userId: null, tier: null, db }
  if (!user.canAccessApi) {
    return {
      error: NextResponse.json({ error: 'API access requires the Organization plan' }, { status: 403 }),
      userId: user.id, tier: user.entitlements.tier, db,
    }
  }
  return { error: null, userId: user.id, tier: user.entitlements.tier, db }
}

export function paginationParams(searchParams: URLSearchParams) {
  const limit = Math.min(parseInt(searchParams.get('limit') || '20'), 100)
  const offset = parseInt(searchParams.get('offset') || '0')
  return { limit, offset }
}

export function csvResponse(data: Record<string, unknown>[], filename: string) {
  if (data.length === 0) return NextResponse.json([])
  const headers = Object.keys(data[0])
  const csv = [
    headers.join(','),
    ...data.map(row => headers.map(h => {
      const v = row[h]
      const val = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
      return /[",\n]/.test(val) ? `"${val.replace(/"/g, '""')}"` : val
    }).join(',')),
  ].join('\n')
  return new NextResponse(csv, {
    headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="${filename}"` },
  })
}

/** Flatten an edge view into the public API shape. */
export function edgeToApi(e: Record<string, unknown>) {
  return {
    id: e.id, type: e.type, role: e.role, amount: e.amount, start_date: e.start_date, end_date: e.end_date,
    from: { id: e.from_id, name: e.from_name ?? e.from_name_raw, kind: e.from_kind, slug: e.from_slug },
    to: { id: e.to_id, name: e.to_name ?? e.to_name_raw, kind: e.to_kind, slug: e.to_slug },
    match_status: e.match_status,
    document: { id: e.document_id, source: e.doc_source, doc_type: e.doc_type, title: e.doc_title, url: e.doc_url, date: e.doc_date },
    attributes: e.attributes,
  }
}
