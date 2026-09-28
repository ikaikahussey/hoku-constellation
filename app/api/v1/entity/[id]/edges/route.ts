import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiRequest, paginationParams, csvResponse, edgeToApi } from '../../../_lib/auth'
import { getEdges } from '@/lib/db/queries'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, db } = await authenticateApiRequest()
  if (error) return error
  const { id } = await params
  const sp = request.nextUrl.searchParams
  const { limit, offset } = paginationParams(sp)
  const types = sp.get('types')?.split(',').filter(Boolean)
  const direction = (sp.get('direction') as 'in' | 'out' | 'both' | null) ?? 'both'
  const rows = await getEdges(db, id, { types, direction, limit, offset, dateRange: { from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined } })
  const data = rows.map(e => edgeToApi(e as unknown as Record<string, unknown>))
  if (sp.get('format') === 'csv') return csvResponse(data.map(r => ({ id: r.id, type: r.type, role: r.role, amount: r.amount, date: r.start_date, from: r.from.name, to: r.to.name, source: r.document.source })), `edges-${id}.csv`)
  return NextResponse.json({ data, limit, offset })
}
