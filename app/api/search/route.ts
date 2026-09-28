import { NextRequest, NextResponse } from 'next/server'
import { getServiceDb } from '@/lib/db/service'
import { searchEntities } from '@/lib/db/queries'
import type { EntityKind } from '@/lib/db/types'

// Public entity search (entity rows are public; edges/documents stay gated by RLS/API gates).
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const q = sp.get('q') || ''
  if (!q) return NextResponse.json({ results: [], total: 0 })
  const type = sp.get('type') || ''
  const kind = type === 'organization' ? 'org' : (type as EntityKind | '')
  const db = await getServiceDb()
  const { results, total } = await searchEntities(db, q, {
    kind: kind || undefined,
    island: sp.get('island') || undefined,
    limit: Math.min(parseInt(sp.get('limit') || '20'), 50),
    offset: parseInt(sp.get('offset') || '0'),
  })
  return NextResponse.json({ results, total })
}
