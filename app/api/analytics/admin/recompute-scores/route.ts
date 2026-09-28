import { NextResponse, type NextRequest } from 'next/server'
import { getServiceDb } from '@/lib/db/service'
import { authenticateCron } from '../../_lib/auth'
import { recomputeAllScoresBatch } from '@/lib/analytics'

export const maxDuration = 300

async function handle(request: NextRequest) {
  const unauth = authenticateCron(request)
  if (unauth) return unauth
  try {
    const count = await recomputeAllScoresBatch(await getServiceDb())
    return NextResponse.json({ ok: true, count })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
