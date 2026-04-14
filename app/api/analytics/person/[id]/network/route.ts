import { NextResponse, type NextRequest } from 'next/server'
import { authenticateSubscriber } from '../../../_lib/auth'
import { getEgoNetwork, toD3Format } from '@/lib/analytics'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { error, supabase } = await authenticateSubscriber()
  if (error) return error
  const { id } = await params
  const hops = Number(request.nextUrl.searchParams.get('hops') ?? '2')
  try {
    const { nodes, links } = await getEgoNetwork(supabase, id, Math.min(3, Math.max(1, hops)))
    return NextResponse.json(toD3Format(nodes, links))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
