import { NextResponse, type NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { authenticateCron } from '../../_lib/auth'
import { recomputeAllScoresBatch } from '@/lib/analytics'

export const maxDuration = 300

async function handle(request: NextRequest) {
  const unauth = authenticateCron(request)
  if (unauth) return unauth
  const supabase = createAdminClient()
  try {
    const count = await recomputeAllScoresBatch(supabase)
    return NextResponse.json({ ok: true, count })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
