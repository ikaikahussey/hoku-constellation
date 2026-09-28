import { NextResponse, type NextRequest } from 'next/server'
import { getServiceDb } from '@/lib/db/service'
import { authenticateCron } from '../../_lib/auth'
import { detectChanges } from '@/lib/analytics'

export const maxDuration = 120

async function handle(request: NextRequest) {
  const unauth = authenticateCron(request)
  if (unauth) return unauth
  const db = await getServiceDb()
  // Default window: last 75 minutes (hourly cron + 15 min overlap).
  const since = request.nextUrl.searchParams.get('since') ?? new Date(Date.now() - 75 * 60 * 1000).toISOString()
  try {
    const { inserted } = await detectChanges(db, since)
    return NextResponse.json({ ok: true, inserted, since })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
