import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authenticateCron } from '../../_lib/auth'
import { detectChanges } from '@/lib/analytics'

export const maxDuration = 120

async function handle(request: NextRequest) {
  const unauth = authenticateCron(request)
  if (unauth) return unauth
  const supabase = createAdminClient()
  // Default window: last 75 minutes (hourly cron + 15min overlap to absorb clock skew
  // and avoid missing records imported right before the previous run finished).
  const sinceParam = request.nextUrl.searchParams.get('since')
  const since = sinceParam ?? new Date(Date.now() - 75 * 60 * 1000).toISOString()
  try {
    const { inserted } = await detectChanges(supabase, since)
    return NextResponse.json({ ok: true, inserted, since })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
