import { NextResponse, type NextRequest } from 'next/server'
import { authenticateSubscriber } from '../_lib/auth'
import { getPowerMap } from '@/lib/analytics'

export async function GET(request: NextRequest) {
  const { error, supabase } = await authenticateSubscriber()
  if (error) return error
  const sp = request.nextUrl.searchParams
  const limit = Math.min(500, Math.max(1, Number(sp.get('limit') ?? '50')))
  const dimension = (sp.get('dimension') ?? 'composite') as
    | 'composite'
    | 'political_money'
    | 'institutional_position'
    | 'lobbying'
    | 'economic_footprint'
    | 'network_centrality'
    | 'public_visibility'
  try {
    const data = await getPowerMap(supabase, {
      dimension,
      limit,
      island: sp.get('island') ?? undefined,
      entity_type: sp.get('entity_type') ?? undefined,
    })
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
