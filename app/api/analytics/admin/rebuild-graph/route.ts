import { NextResponse, type NextRequest } from 'next/server'
import { getServiceDb } from '@/lib/db/service'
import { authenticateCron } from '../../_lib/auth'
import { rebuildGraph } from '@/lib/analytics'

export const maxDuration = 300

async function handle(request: NextRequest) {
  const unauth = authenticateCron(request)
  if (unauth) return unauth
  try {
    const result = await rebuildGraph(await getServiceDb())
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
