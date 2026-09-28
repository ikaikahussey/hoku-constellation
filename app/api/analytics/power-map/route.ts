import { NextResponse, type NextRequest } from 'next/server'
import { authenticateSubscriber } from '../_lib/auth'
import { getPowerMap } from '@/lib/analytics'
import type { Dimension } from '@/lib/analytics/reports/power-map'

export async function GET(request: NextRequest) {
  const { error, db } = await authenticateSubscriber()
  if (error) return error
  const sp = request.nextUrl.searchParams
  try {
    const data = await getPowerMap(db, {
      dimension: (sp.get('dimension') ?? 'composite') as Dimension,
      limit: Math.min(500, Math.max(1, Number(sp.get('limit') ?? '50'))),
      island: sp.get('island') ?? undefined,
      entity_type: sp.get('entity_type') ?? undefined,
    })
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
