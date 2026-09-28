import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiRequest } from '../../_lib/auth'
import { getEntity, getEdgeTotals } from '@/lib/db/queries'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, db } = await authenticateApiRequest()
  if (error) return error
  const { id } = await params
  const entity = await getEntity(db, id)
  if (!entity) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const totals = await getEdgeTotals(db, entity.id)
  return NextResponse.json({ ...entity, edge_totals: totals })
}
