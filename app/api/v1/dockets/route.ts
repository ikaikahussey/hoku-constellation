import { NextRequest, NextResponse } from 'next/server'
import { authenticateApiRequest, paginationParams } from '../_lib/auth'

export async function GET(request: NextRequest) {
  const { error, db } = await authenticateApiRequest()
  if (error) return error
  const sp = request.nextUrl.searchParams
  const { limit, offset } = paginationParams(sp)
  const params: unknown[] = []
  const where = [`kind = 'docket'`]
  if (sp.get('status')) { params.push(sp.get('status')); where.push(`attributes ->> 'docket_status' = $${params.length}`) }
  if (sp.get('utility_type')) { params.push(sp.get('utility_type')); where.push(`attributes ->> 'utility_type' = $${params.length}`) }
  if (sp.get('agency')) { params.push(sp.get('agency')); where.push(`attributes ->> 'agency' = $${params.length}`) }
  params.push(limit, offset)
  const data = await db.many(`select id, name, identifiers, attributes from entity where ${where.join(' and ')} order by attributes ->> 'filed_date' desc nulls last limit $${params.length - 1} offset $${params.length}`, params)
  return NextResponse.json({ data, limit, offset })
}
