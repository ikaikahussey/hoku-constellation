import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiRequest, paginationParams } from '../_lib/auth'
import { searchEntities } from '@/lib/db/queries'
import type { EntityKind } from '@/lib/db/types'

export async function GET(request: NextRequest) {
  const { error, db } = await authenticateApiRequest()
  if (error) return error
  const sp = request.nextUrl.searchParams
  const q = sp.get('q') || ''
  const { limit, offset } = paginationParams(sp)
  if (!q) return NextResponse.json({ results: [], total: 0, limit, offset })
  const type = sp.get('type') || sp.get('kind') || ''
  const kind = type === 'organization' ? 'org' : (type as EntityKind | '')
  const { results, total } = await searchEntities(db, q, { kind: kind || undefined, limit, offset })
  return NextResponse.json({ results, total, limit, offset })
}
