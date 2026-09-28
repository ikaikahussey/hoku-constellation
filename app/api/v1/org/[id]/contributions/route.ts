import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiRequest, paginationParams, csvResponse, edgeToApi } from '../../../_lib/auth'
import { getEdges } from '@/lib/db/queries'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { error, db } = await authenticateApiRequest()
  if (error) return error
  const { id } = await params
  const { limit, offset } = paginationParams(request.nextUrl.searchParams)
  const rows = await getEdges(db, id, { types: ['contributed_to', 'spent_with', 'loaned_to'], direction: 'both', limit, offset })
  const data = rows.map(e => edgeToApi(e as unknown as Record<string, unknown>))
  if (request.nextUrl.searchParams.get('format') === 'csv') return csvResponse(data.map(r => ({ id: r.id, type: r.type, date: r.start_date, from: r.from.name, to: r.to.name, amount: r.amount })), `org-contributions-${id}.csv`)
  return NextResponse.json({ data, limit, offset })
}
