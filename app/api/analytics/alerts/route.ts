import { NextResponse, type NextRequest } from 'next/server'
import { authenticateSubscriber } from '../_lib/auth'
import { listAlerts } from '@/lib/analytics'

export async function GET(request: NextRequest) {
  const { error, supabase } = await authenticateSubscriber()
  if (error) return error
  const sp = request.nextUrl.searchParams
  try {
    const data = await listAlerts(supabase, {
      personId: sp.get('person_id') ?? undefined,
      orgId: sp.get('org_id') ?? undefined,
      limit: Math.min(200, Number(sp.get('limit') ?? '50')),
    })
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
